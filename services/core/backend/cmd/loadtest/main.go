// Command loadtest drives Core with deterministic, locally replayed simulations.
// It uses Platform development auth so every virtual client has its own account.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	sim "doofyduck/simulation"
)

type snapshot struct {
	RunID            string    `json:"runId"`
	WriterToken      string    `json:"writerToken"`
	WriterGeneration int64     `json:"writerGeneration"`
	Checkpoint       int64     `json:"checkpointSequence"`
	ActiveTicks      int64     `json:"activeTicks"`
	ActiveTickLimit  int64     `json:"activeTickLimit"`
	CompletionReason string    `json:"completionReason"`
	Status           string    `json:"status"`
	Verification     string    `json:"verificationStatus"`
	Delivery         string    `json:"deliveryStatus"`
	State            sim.State `json:"state"`
}

type checkpoint struct {
	CheckpointSequence int64         `json:"checkpointSequence"`
	WriterGeneration   int64         `json:"writerGeneration"`
	WriterToken        string        `json:"writerToken"`
	IdempotencyKey     string        `json:"idempotencyKey"`
	Ticks              [][]sim.Input `json:"ticks"`
}

type queuedCheckpoint struct {
	Request checkpoint
	State   sim.State
}

type metrics struct {
	mu                 sync.Mutex
	latencies          []time.Duration
	requests           int64
	accepted           int64
	generated          int64
	retried            int64
	idempotence        int64
	completed          int64
	unacked            int64
	acceptedTicks      int64
	activeClients      int64
	retryFailures      int64
	offlineQueued      int64
	outageErrors       int64
	maxDrainMS         int64
	errors             int64
	dead               int64
	flightCaps         int64
	started            int64
	startErrors        int64
	startupReady       int64
	startupRetries     int64
	rateLimited        int64
	checkpointFailures int64
}

func main() {
	base := flag.String("core", env("CORE_LOAD_BASE_URL", "http://127.0.0.1:8080"), "Core base URL")
	platform := flag.String("platform", env("CORE_LOAD_PLATFORM_URL", "http://127.0.0.1:8080"), "Platform base URL for development auth")
	operatorURL := flag.String("operator-url", env("CORE_LOAD_OPERATOR_URL", env("CORE_LOAD_BASE_URL", "http://127.0.0.1:8080")), "Core URL for authenticated outage operations")
	clients := flag.Int("clients", envInt("CORE_LOAD_CLIENTS", 1000), "virtual accounts")
	duration := flag.Duration("duration", envDuration("CORE_LOAD_DURATION", time.Hour), "load duration")
	startupTimeout := flag.Duration("startup-timeout", 2*time.Minute, "maximum time to authenticate clients and issue their initial runs before measured load")
	rate := flag.Float64("checkpoints-per-second", envFloat("CORE_LOAD_CHECKPOINTS_PER_SECOND", 500), "aggregate checkpoint target rate")
	minimumRate := flag.Float64("minimum-checkpoint-rate", 0, "fail when achieved rate falls below this value; defaults to 90% of target")
	maxP95 := flag.Duration("maximum-p95", time.Second, "fail when checkpoint request p95 exceeds this latency")
	maxFailureFraction := flag.Float64("maximum-failure-fraction", .01, "fail when failed checkpoint requests exceed this fraction of attempts")
	outageAfter := flag.Duration("outage-after", 0, "optional simulated client disconnect delay")
	outageFor := flag.Duration("outage-duration", 0, "optional simulated disconnect duration; records a Core operator outage")
	operatorToken := flag.String("operator-token", env("CORE_LOAD_OPERATOR_TOKEN", env("CORE_OPERATOR_TOKEN", "")), "Core operator token, required for outage simulation")
	userID := flag.Int64("telegram-user-id-start", envInt64("CORE_LOAD_TELEGRAM_USER_ID_START", 900000000), "first Telegram development account ID")
	reconnectSpread := flag.Duration("reconnect-spread", 0, "spread client reconnects across this duration")
	flag.Parse()
	if *clients < 1 || *clients > 10000 || *duration <= 0 || *startupTimeout <= 0 || *rate <= 0 || *maxFailureFraction < 0 || *maxFailureFraction > 1 || *reconnectSpread < 0 || *reconnectSpread > *duration || (*reconnectSpread > 0 && *outageFor == 0) {
		fmt.Fprintln(os.Stderr, "clients must be 1..10000; duration, startup timeout, and checkpoint rate must be positive; maximum failure fraction must be between 0 and 1; reconnect spread requires an outage and must be within the duration")
		os.Exit(2)
	}
	if *outageAfter < 0 || *outageFor < 0 || (*outageFor > 0 && *operatorToken == "") || (*outageFor > 0 && *outageAfter+*outageFor+*reconnectSpread > *duration) {
		fmt.Fprintln(os.Stderr, "outage durations must be nonnegative and outage simulation requires CORE_LOAD_OPERATOR_TOKEN")
		os.Exit(2)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	var m metrics
	startupStarted := time.Now()
	startupDeadline := startupStarted.Add(*startupTimeout)
	if *minimumRate <= 0 {
		*minimumRate = *rate * .9
	}
	createGate := make(chan struct{})
	flightGate := make(chan struct{})
	var wg sync.WaitGroup
	var runsReady sync.WaitGroup
	runsReady.Add(*clients)
	var startedAt time.Time
	var deadline time.Time
	var offlineStart, offlineEnd time.Time
	var outageWG sync.WaitGroup
	metricsDone := make(chan struct{})
	var metricsWG sync.WaitGroup
	var prepared sync.WaitGroup
	for i := 0; i < *clients; i++ {
		wg.Add(1)
		prepared.Add(1)
		go func(index int) {
			defer wg.Done()
			id := *userID + int64(index)
			token, err := authTokenUntil(client, *platform, id, startupDeadline, &m)
			if err != nil {
				atomic.AddInt64(&m.startErrors, 1)
				prepared.Done()
				runsReady.Done()
				fmt.Fprintf(os.Stderr, "load client authentication failed: %v\n", err)
				return
			}
			prepared.Done()
			<-createGate
			run, err := createOrTakeoverRun(client, *base, *platform, id, token, startupDeadline, &m)
			if err != nil {
				atomic.AddInt64(&m.startErrors, 1)
				runsReady.Done()
				fmt.Fprintf(os.Stderr, "load client initial run creation failed: %v\n", err)
				return
			}
			atomic.AddInt64(&m.startupReady, 1)
			runsReady.Done()
			<-flightGate
			clientLoop(client, *base, *platform, id, token, run, deadline, offlineStart, offlineEnd, index, *clients, *reconnectSpread, time.Duration(float64(time.Second)*float64(*clients) / *rate), &m)
		}(i)
	}
	prepared.Wait()
	close(createGate)
	runsReady.Wait()
	if ready := atomic.LoadInt64(&m.startupReady); ready != int64(*clients) {
		fmt.Printf("startup_complete=false startup_runs_ready=%d requested_clients=%d startup_seconds=%.1f startup_retries=%d start_errors=%d\n", ready, *clients, time.Since(startupStarted).Seconds(), atomic.LoadInt64(&m.startupRetries), atomic.LoadInt64(&m.startErrors))
		os.Exit(1)
	}
	startedAt = time.Now()
	deadline = startedAt.Add(*duration)
	metricsWG.Add(1)
	go func(start time.Time) {
		defer metricsWG.Done()
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				elapsed := time.Since(start).Seconds()
				if elapsed > 0 {
					fmt.Printf("progress_seconds=%.0f clients_active=%d checkpoints=%d accepted=%d offline_queued=%d retry_failures=%d fatal_errors=%d checkpoint_rate=%.1f/s tick_rate=%.1f/s max_outage_drain_ms=%d\n", elapsed, atomic.LoadInt64(&m.activeClients), atomic.LoadInt64(&m.requests), atomic.LoadInt64(&m.accepted), atomic.LoadInt64(&m.offlineQueued), atomic.LoadInt64(&m.retryFailures), atomic.LoadInt64(&m.errors), float64(atomic.LoadInt64(&m.accepted))/elapsed, float64(atomic.LoadInt64(&m.acceptedTicks))/elapsed, atomic.LoadInt64(&m.maxDrainMS))
				}
			case <-metricsDone:
				return
			}
		}
	}(startedAt)
	if *outageFor > 0 {
		offlineStart = startedAt.Add(*outageAfter)
		offlineEnd = offlineStart.Add(*outageFor)
		outageWG.Add(1)
		go func() {
			defer outageWG.Done()
			recordOutage(client, *operatorURL, *operatorToken, offlineStart, offlineEnd, &m)
		}()
	}
	close(flightGate)
	wg.Wait()
	outageWG.Wait()
	close(metricsDone)
	metricsWG.Wait()
	elapsed := time.Since(startedAt)
	m.mu.Lock()
	latencies := append([]time.Duration(nil), m.latencies...)
	m.mu.Unlock()
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	percentile := func(p float64) time.Duration {
		if len(latencies) == 0 {
			return 0
		}
		index := int(float64(len(latencies)-1) * p)
		return latencies[index]
	}
	requests := atomic.LoadInt64(&m.requests)
	accepted := atomic.LoadInt64(&m.accepted)
	rateLimited := atomic.LoadInt64(&m.rateLimited)
	checkpointFailures := atomic.LoadInt64(&m.checkpointFailures)
	actualRate := float64(accepted) / elapsed.Seconds()
	rateLimitPercent := 0.0
	if requests > 0 {
		rateLimitPercent = float64(rateLimited) * 100 / float64(requests)
	}
	failureFraction := 0.0
	if requests > 0 {
		failureFraction = float64(checkpointFailures) / float64(requests)
	}
	p95 := percentile(.95)
	fmt.Printf("clients_active_end=%d runs_started=%d startup_runs_ready=%d startup_seconds=%.1f startup_retries=%d start_errors=%d checkpoints=%d accepted=%d unacked=%d offline_queued=%d outage_errors=%d max_outage_drain_ms=%d rate_limited=%d rate_limited_percent=%.2f checkpoint_failures=%d checkpoint_failure_fraction=%.4f maximum_failure_fraction=%.4f retry_failures=%d retries=%d idempotence_checks=%d completions=%d fatal_errors=%d deaths=%d flight_caps=%d p95_ms=%d elapsed_seconds=%.1f checkpoint_rate=%.1f/s tick_rate=%.1f/s target_checkpoint_rate=%.1f/s minimum_checkpoint_rate=%.1f/s\n",
		atomic.LoadInt64(&m.activeClients), atomic.LoadInt64(&m.started), atomic.LoadInt64(&m.startupReady), startedAt.Sub(startupStarted).Seconds(), atomic.LoadInt64(&m.startupRetries), atomic.LoadInt64(&m.startErrors), requests, accepted, atomic.LoadInt64(&m.unacked), atomic.LoadInt64(&m.offlineQueued), atomic.LoadInt64(&m.outageErrors), atomic.LoadInt64(&m.maxDrainMS), rateLimited, rateLimitPercent, checkpointFailures, failureFraction, *maxFailureFraction, atomic.LoadInt64(&m.retryFailures), atomic.LoadInt64(&m.retried), atomic.LoadInt64(&m.idempotence), atomic.LoadInt64(&m.completed), atomic.LoadInt64(&m.errors), atomic.LoadInt64(&m.dead), atomic.LoadInt64(&m.flightCaps), p95.Milliseconds(), elapsed.Seconds(), actualRate, float64(atomic.LoadInt64(&m.acceptedTicks))/elapsed.Seconds(), *rate, *minimumRate)
	if atomic.LoadInt64(&m.startErrors) > 0 || atomic.LoadInt64(&m.errors) > 0 || atomic.LoadInt64(&m.outageErrors) > 0 || atomic.LoadInt64(&m.unacked) > 0 || actualRate < *minimumRate || p95 > *maxP95 || checkpointFailureFractionExceeded(checkpointFailures, requests, *maxFailureFraction) {
		os.Exit(1)
	}
}

func clientLoop(client *http.Client, base, platform string, accountID int64, token string, initialRun snapshot, deadline, offlineStart, offlineEnd time.Time, clientIndex, clientCount int, reconnectSpread, interval time.Duration, m *metrics) {
	atomic.AddInt64(&m.activeClients, 1)
	defer atomic.AddInt64(&m.activeClients, -1)
	if interval < time.Millisecond {
		interval = time.Millisecond
	}
	if phase := clientStartDelay(clientIndex, clientCount, interval); phase > 0 {
		time.Sleep(phase)
	}
	reconnectAt := offlineEnd.Add(reconnectDelay(clientIndex, clientCount, reconnectSpread))
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	nextTokenRefresh := time.Now().Add(8 * time.Minute)
	useInitialRun := true
	for time.Now().Before(deadline) {
		if time.Now().After(nextTokenRefresh) {
			refreshed, err := authToken(client, platform, accountID)
			if err != nil {
				atomic.AddInt64(&m.errors, 1)
				return
			}
			token = refreshed
			nextTokenRefresh = time.Now().Add(8 * time.Minute)
		}
		run := initialRun
		if useInitialRun {
			useInitialRun = false
		} else {
			created, err := createOrTakeoverRun(client, base, platform, accountID, token, deadline, m)
			if err != nil {
				atomic.AddInt64(&m.errors, 1)
				fmt.Fprintf(os.Stderr, "load client run creation failed: %v\n", err)
				return
			}
			run = created
		}
		atomic.AddInt64(&m.started, 1)
		state := run.State
		inputSequence := state.NextInputSequence
		checkpointSequence := run.Checkpoint + 1
		activeTicks := run.ActiveTicks
		activeTickLimit := run.ActiveTickLimit
		if activeTickLimit <= 0 {
			activeTickLimit = 216000
		}
		observedTarget := int64(280000)
		dead := false
		flightCap := false
		backlog := make([]queuedCheckpoint, 0)
		applyCheckpoint := func(item queuedCheckpoint) error {
			ack, refreshedToken, err := submitCheckpoint(client, base, platform, accountID, token, run.RunID, item.Request, deadline, m)
			token = refreshedToken
			if err != nil {
				atomic.AddInt64(&m.unacked, 1)
				return err
			}
			if !sameState(ack.State, item.State) {
				return fmt.Errorf("server simulation state differs after checkpoint %d", item.Request.CheckpointSequence)
			}
			activeTicks = ack.ActiveTicks
			if item.State.Phase == sim.Dead {
				dead = true
				atomic.AddInt64(&m.dead, 1)
			} else if ack.CompletionReason == "flight_cap" {
				flightCap = true
				atomic.AddInt64(&m.flightCaps, 1)
			}
			atomic.AddInt64(&m.accepted, 1)
			atomic.AddInt64(&m.acceptedTicks, int64(len(item.Request.Ticks)))
			if (item.Request.CheckpointSequence+1)%60 == 0 {
				atomic.AddInt64(&m.idempotence, 1)
				replayed, refreshedToken, replayErr := submitCheckpoint(client, base, platform, accountID, token, run.RunID, item.Request, deadline, m)
				token = refreshedToken
				if replayErr != nil || !sameState(replayed.State, ack.State) {
					return fmt.Errorf("checkpoint %d idempotent replay mismatch", item.Request.CheckpointSequence)
				}
			}
			return nil
		}
		flushBacklog := func() error {
			started := time.Now()
			for len(backlog) > 0 {
				if err := applyCheckpoint(backlog[0]); err != nil {
					return err
				}
				backlog = backlog[1:]
			}
			drainMS := time.Since(started).Milliseconds()
			for old := atomic.LoadInt64(&m.maxDrainMS); drainMS > old; old = atomic.LoadInt64(&m.maxDrainMS) {
				if atomic.CompareAndSwapInt64(&m.maxDrainMS, old, drainMS) {
					break
				}
			}
			return nil
		}
		for time.Now().Before(deadline) && !dead && !flightCap {
			<-ticker.C
			if !time.Now().Before(deadline) {
				break
			}
			if time.Now().After(nextTokenRefresh) {
				refreshed, err := authToken(client, platform, accountID)
				if err != nil {
					atomic.AddInt64(&m.errors, 1)
					return
				}
				token = refreshed
				nextTokenRefresh = time.Now().Add(8 * time.Minute)
			}
			batchSize := int((interval * 60) / time.Second)
			if batchSize < 1 {
				batchSize = 1
			}
			if batchSize > 120 {
				batchSize = 120
			}
			remainingTicks := activeTickLimit - activeTicks
			if remainingTicks < 1 {
				atomic.AddInt64(&m.errors, 1)
				fmt.Fprintln(os.Stderr, "load client reached active tick cap without a terminal server snapshot")
				return
			}
			if int64(batchSize) > remainingTicks {
				batchSize = int(remainingTicks)
			}
			batch := make([][]sim.Input, 0, batchSize)
			for i := 0; i < batchSize && state.Phase != sim.Dead; i++ {
				active := state.Pipes[len(state.Pipes)-1]
				for _, pipe := range state.Pipes {
					if pipe.X >= state.Duck.X {
						active = pipe
						break
					}
				}
				if active.X <= 360000 {
					observedTarget = active.GapCenter
				}
				inputs := []sim.Input{}
				if state.Phase == sim.Ready || state.Duck.Y > observedTarget+24000 {
					inputs = append(inputs, sim.Input{Sequence: inputSequence, Action: "FLAP"})
					inputSequence++
				}
				step, err := sim.Step(state, inputs)
				if err != nil {
					atomic.AddInt64(&m.errors, 1)
					return
				}
				state = step.State
				batch = append(batch, inputs)
			}
			if len(batch) == 0 {
				break
			}
			atomic.AddInt64(&m.generated, 1)
			request := checkpoint{CheckpointSequence: checkpointSequence, WriterGeneration: run.WriterGeneration, WriterToken: run.WriterToken, IdempotencyKey: uuid(), Ticks: batch}
			item := queuedCheckpoint{Request: request, State: state}
			if !offlineStart.IsZero() && !time.Now().Before(offlineStart) && time.Now().Before(reconnectAt) {
				backlog = append(backlog, item)
				activeTicks += int64(len(batch))
				if state.Phase == sim.Dead {
					dead = true
				} else if activeTicks == activeTickLimit {
					flightCap = true
				}
				atomic.AddInt64(&m.offlineQueued, 1)
			} else {
				if len(backlog) > 0 {
					if err := flushBacklog(); err != nil {
						atomic.AddInt64(&m.errors, 1)
						fmt.Fprintf(os.Stderr, "load client reconnect drain failed: %v\n", err)
						return
					}
				}
				if err := applyCheckpoint(item); err != nil {
					atomic.AddInt64(&m.errors, 1)
					fmt.Fprintf(os.Stderr, "load client checkpoint failed: %v\n", err)
					return
				}
			}
			checkpointSequence++
		}
		if len(backlog) > 0 {
			for time.Now().Before(reconnectAt) && time.Now().Before(deadline) {
				time.Sleep(100 * time.Millisecond)
			}
			if len(backlog) > 0 && time.Now().Before(deadline) {
				if err := flushBacklog(); err != nil {
					atomic.AddInt64(&m.errors, 1)
					fmt.Fprintf(os.Stderr, "load client reconnect drain failed: %v\n", err)
					return
				}
			} else if len(backlog) > 0 {
				atomic.AddInt64(&m.unacked, int64(len(backlog)))
			}
		}
		if dead || flightCap {
			// Give receipts for already completed flights a bounded drain period after load generation stops.
			if _, err := awaitCompletion(client, base, platform, accountID, token, run.RunID, deadline.Add(5*time.Second), m); err != nil {
				atomic.AddInt64(&m.errors, 1)
				return
			}
			atomic.AddInt64(&m.completed, 1)
		}
	}
}

func authToken(c *http.Client, platform string, id int64) (string, error) {
	return authTokenUntil(c, platform, id, time.Now().Add(30*time.Second), nil)
}

func authTokenUntil(c *http.Client, platform string, id int64, deadline time.Time, m *metrics) (string, error) {
	body, _ := json.Marshal(map[string]int64{"telegram_user_id": id})
	url := strings.TrimRight(platform, "/") + "/api/v1/auth/dev"
	backoff := 100 * time.Millisecond
	for attempt := 0; time.Now().Before(deadline); attempt++ {
		retryAfter := time.Duration(0)
		resp, err := c.Post(url, "application/json", bytes.NewReader(body))
		if err == nil {
			if resp.StatusCode == http.StatusOK {
				var result struct {
					AccessToken string `json:"access_token"`
				}
				err = json.NewDecoder(resp.Body).Decode(&result)
				resp.Body.Close()
				if err == nil && result.AccessToken == "" {
					err = io.ErrUnexpectedEOF
				}
				return result.AccessToken, err
			}
			retryAfter = parseRetryAfter(resp.Header.Get("Retry-After"), time.Now())
			status := resp.StatusCode
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if status != http.StatusTooManyRequests && status != http.StatusServiceUnavailable && status < 500 {
				return "", fmt.Errorf("dev auth returned %d", status)
			}
			err = &httpStatusError{operation: "dev auth", status: status, retryAfter: retryAfter}
		}
		if !isTransientError(err) {
			return "", err
		}
		if m != nil {
			atomic.AddInt64(&m.startupRetries, 1)
			atomic.AddInt64(&m.retried, 1)
		}
		delay := startupRetryDelay(id, attempt, backoff, retryAfterFromError(err))
		if !sleepBefore(deadline, delay) {
			break
		}
		if backoff < 5*time.Second {
			backoff *= 2
		}
	}
	return "", fmt.Errorf("dev auth remained unavailable until startup deadline")
}

func createRun(c *http.Client, base, token string) (snapshot, error) {
	resp, err := authorized(c, http.MethodPost, strings.TrimRight(base, "/")+"/api/v1/runs", token, nil)
	if err != nil {
		return snapshot{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		statusErr := responseStatusError("create run", resp)
		io.Copy(io.Discard, resp.Body)
		return snapshot{}, statusErr
	}
	var result snapshot
	err = json.NewDecoder(resp.Body).Decode(&result)
	if err == nil && (result.RunID == "" || (resp.StatusCode == http.StatusCreated && result.WriterToken == "")) {
		err = io.ErrUnexpectedEOF
	}
	return result, err
}

func createOrTakeoverRun(c *http.Client, base, platform string, accountID int64, token string, deadline time.Time, m *metrics) (snapshot, error) {
	backoff := 100 * time.Millisecond
	for attempt := 0; time.Now().Before(deadline); attempt++ {
		retry := func(retryAfter time.Duration) bool {
			if m != nil {
				atomic.AddInt64(&m.startupRetries, 1)
				atomic.AddInt64(&m.retried, 1)
			}
			delay := startupRetryDelay(accountID, attempt, backoff, retryAfter)
			if backoff < 5*time.Second {
				backoff *= 2
			}
			return sleepBefore(deadline, delay)
		}
		run, err := createRun(c, base, token)
		if err == nil && run.WriterToken != "" {
			return run, nil
		}
		if err != nil {
			statusErr, isStatusErr := statusError(err)
			if isStatusErr && statusErr.status == http.StatusConflict {
				// A current run needs recovery below.
			} else if isTransientError(err) {
				if retry(retryAfterFromError(err)) {
					continue
				}
				return snapshot{}, fmt.Errorf("initial run creation retries exceeded startup deadline: %w", err)
			} else {
				return snapshot{}, err
			}
		}
		if err != nil {
			req, e := authorized(c, http.MethodGet, strings.TrimRight(base, "/")+"/api/v1/runs/current", token, nil)
			if e != nil {
				if isTransientError(e) && retry(retryAfterFromError(e)) {
					continue
				}
				return snapshot{}, fmt.Errorf("current run recovery failed: %w", e)
			}
			if req.StatusCode != http.StatusOK {
				statusErr := responseStatusError("get current run", req)
				io.Copy(io.Discard, req.Body)
				req.Body.Close()
				if isTransientError(statusErr) || req.StatusCode == http.StatusNotFound {
					if retry(retryAfterFromError(statusErr)) {
						continue
					}
					break
				}
				return snapshot{}, statusErr
			}
			e = json.NewDecoder(req.Body).Decode(&run)
			req.Body.Close()
			if e != nil {
				return snapshot{}, e
			}
			if run.Status == "completion_pending" {
				token, e = awaitCompletion(c, base, platform, accountID, token, run.RunID, deadline, m)
				if e != nil {
					return snapshot{}, e
				}
				continue
			}
		}
		if run.RunID != "" {
			req, e := authorized(c, http.MethodPost, strings.TrimRight(base, "/")+"/api/v1/runs/"+run.RunID+"/takeover", token, nil)
			if e != nil {
				if isTransientError(e) && retry(retryAfterFromError(e)) {
					continue
				}
				return snapshot{}, fmt.Errorf("run takeover failed: %w", e)
			}
			if req.StatusCode == http.StatusOK {
				var result snapshot
				e = json.NewDecoder(req.Body).Decode(&result)
				req.Body.Close()
				if e == nil && result.WriterToken != "" {
					return result, nil
				}
				return snapshot{}, fmt.Errorf("takeover response was incomplete: %w", e)
			}
			statusErr := responseStatusError("takeover", req)
			io.Copy(io.Discard, req.Body)
			req.Body.Close()
			if isTransientError(statusErr) || req.StatusCode == http.StatusConflict {
				if retry(retryAfterFromError(statusErr)) {
					continue
				}
				break
			}
			return snapshot{}, statusErr
		}
		if !retry(0) {
			break
		}
	}
	return snapshot{}, fmt.Errorf("could not create or recover a run before startup deadline")
}

type httpStatusError struct {
	operation  string
	status     int
	retryAfter time.Duration
}

func (err *httpStatusError) Error() string {
	return fmt.Sprintf("%s returned %d", err.operation, err.status)
}

func statusError(err error) (*httpStatusError, bool) {
	var result *httpStatusError
	if errors.As(err, &result) {
		return result, true
	}
	return nil, false
}

func responseStatusError(operation string, response *http.Response) *httpStatusError {
	return &httpStatusError{
		operation:  operation,
		status:     response.StatusCode,
		retryAfter: parseRetryAfter(response.Header.Get("Retry-After"), time.Now()),
	}
}

func retryAfterFromError(err error) time.Duration {
	status, ok := statusError(err)
	if !ok {
		return 0
	}
	return status.retryAfter
}

func isTransientError(err error) bool {
	if status, ok := statusError(err); ok {
		return status.status == http.StatusTooManyRequests || status.status >= 500
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return true
	}
	var networkErr net.Error
	return errors.As(err, &networkErr)
}

func parseRetryAfter(value string, now time.Time) time.Duration {
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if retryAt, err := http.ParseTime(value); err == nil && retryAt.After(now) {
		return retryAt.Sub(now)
	}
	return 0
}

func startupRetryDelay(accountID int64, attempt int, backoff, retryAfter time.Duration) time.Duration {
	base := backoff
	if retryAfter > base {
		base = retryAfter
	}
	jitterLimit := backoff / 2
	if jitterLimit < 10*time.Millisecond {
		jitterLimit = 10 * time.Millisecond
	}
	seed := uint64(accountID)*0x9e3779b97f4a7c15 ^ uint64(attempt+1)*0xbf58476d1ce4e5b9
	jitter := time.Duration(seed % uint64(jitterLimit+1))
	return base + jitter
}

func sleepBefore(deadline time.Time, delay time.Duration) bool {
	remaining := time.Until(deadline)
	if remaining <= 0 || delay >= remaining {
		return false
	}
	time.Sleep(delay)
	return time.Now().Before(deadline)
}

func postCheckpoint(c *http.Client, base, token, runID string, body checkpoint) (int, time.Duration, snapshot, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return 0, 0, snapshot{}, err
	}
	resp, err := authorized(c, http.MethodPost, strings.TrimRight(base, "/")+"/api/v1/runs/"+runID+"/checkpoints", token, encoded)
	if err != nil {
		return 0, 0, snapshot{}, err
	}
	defer resp.Body.Close()
	var result snapshot
	if resp.StatusCode == http.StatusOK {
		err = json.NewDecoder(resp.Body).Decode(&result)
	} else {
		io.Copy(io.Discard, resp.Body)
	}
	retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"), time.Now())
	return resp.StatusCode, retryAfter, result, err
}

func submitCheckpoint(c *http.Client, base, platform string, accountID int64, token, runID string, body checkpoint, deadline time.Time, m *metrics) (snapshot, string, error) {
	backoff := 250 * time.Millisecond
	retryAttempt := 0
	for time.Now().Before(deadline) {
		started := time.Now()
		status, retryAfter, result, err := postCheckpoint(c, base, token, runID, body)
		atomic.AddInt64(&m.requests, 1)
		if err != nil || status != http.StatusOK {
			atomic.AddInt64(&m.checkpointFailures, 1)
		}
		if status == http.StatusTooManyRequests {
			atomic.AddInt64(&m.rateLimited, 1)
		}
		m.mu.Lock()
		m.latencies = append(m.latencies, time.Since(started))
		m.mu.Unlock()
		if err == nil && status == http.StatusOK {
			return result, token, nil
		}
		if err == nil && status == http.StatusUnauthorized {
			refreshed, refreshErr := authToken(c, platform, accountID)
			if refreshErr != nil {
				return snapshot{}, token, refreshErr
			}
			token = refreshed
			continue
		}
		if status != http.StatusTooManyRequests && status < 500 && err == nil {
			return snapshot{}, token, fmt.Errorf("checkpoint returned %d", status)
		}
		atomic.AddInt64(&m.retried, 1)
		atomic.AddInt64(&m.retryFailures, 1)
		wait := startupRetryDelay(accountID, retryAttempt, backoff, retryAfter)
		retryAttempt++
		if wait > 30*time.Second {
			wait = 30 * time.Second
		}
		time.Sleep(wait)
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
	return snapshot{}, token, fmt.Errorf("checkpoint remained unacknowledged until load deadline")
}

type deadlineTransport struct {
	ctx  context.Context
	base http.RoundTripper
}

func (t deadlineTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return t.base.RoundTrip(req.WithContext(t.ctx))
}

func awaitCompletion(c *http.Client, base, platform string, accountID int64, token, runID string, deadline time.Time, m *metrics) (string, error) {
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()
	boundedClient := *c
	transport := c.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	boundedClient.Transport = deadlineTransport{ctx: ctx, base: transport}
	nextRefresh := time.Now().Add(8 * time.Minute)
	for time.Now().Before(deadline) {
		if time.Now().After(nextRefresh) {
			refreshed, err := authTokenUntil(&boundedClient, platform, accountID, deadline, nil)
			if err != nil {
				return token, err
			}
			token = refreshed
			nextRefresh = time.Now().Add(8 * time.Minute)
		}
		req, err := authorized(&boundedClient, http.MethodGet, strings.TrimRight(base, "/")+"/api/v1/runs/"+runID, token, nil)
		if err != nil {
			if !sleepBefore(deadline, time.Second) {
				break
			}
			continue
		}
		var run snapshot
		err = json.NewDecoder(req.Body).Decode(&run)
		req.Body.Close()
		if err == nil && req.StatusCode == http.StatusOK && completionAccepted(run) {
			return token, nil
		}
		if err == nil && req.StatusCode == http.StatusOK && (run.Status == "rejected" || run.Status == "abandoned") {
			return token, fmt.Errorf("run completion ended with status=%s verification=%s delivery=%s", run.Status, run.Verification, run.Delivery)
		}
		if req.StatusCode != http.StatusOK && req.StatusCode != http.StatusServiceUnavailable {
			return token, fmt.Errorf("completion status poll returned %d", req.StatusCode)
		}
		if req.StatusCode == http.StatusServiceUnavailable {
			atomic.AddInt64(&m.retried, 1)
		}
		if !sleepBefore(deadline, 500*time.Millisecond) {
			break
		}
	}
	return token, fmt.Errorf("completion delivery remained pending until load deadline")
}

func completionAccepted(run snapshot) bool {
	return run.Status == "completed" && run.Verification == "verified" && run.Delivery == "delivered"
}

func reconnectDelay(index, count int, spread time.Duration) time.Duration {
	if count < 2 || index <= 0 || spread <= 0 {
		return 0
	}
	if index >= count-1 {
		return spread
	}
	return time.Duration(index) * spread / time.Duration(count-1)
}

func clientStartDelay(index, count int, interval time.Duration) time.Duration {
	if count < 2 || index <= 0 || interval <= 0 {
		return 0
	}
	if index >= count-1 {
		return interval * time.Duration(count-1) / time.Duration(count)
	}
	return time.Duration(index) * interval / time.Duration(count)
}

func checkpointFailureFractionExceeded(failures, requests int64, maximum float64) bool {
	if requests <= 0 {
		return failures > 0
	}
	return float64(failures)/float64(requests) > maximum
}

func recordOutage(c *http.Client, base, token string, start, end time.Time, m *metrics) {
	if wait := time.Until(start); wait > 0 {
		time.Sleep(wait)
	}
	startedAt := time.Now().Add(-time.Second)
	body, _ := json.Marshal(map[string]string{"startedAt": startedAt.Format(time.RFC3339Nano)})
	resp, err := authorized(c, http.MethodPost, strings.TrimRight(base, "/")+"/internal/v1/outages/start", token, body)
	if err != nil {
		atomic.AddInt64(&m.outageErrors, 1)
		fmt.Fprintf(os.Stderr, "load outage start failed: %v\n", err)
		return
	}
	var result struct {
		ID string `json:"id"`
	}
	if resp.StatusCode != http.StatusCreated || json.NewDecoder(resp.Body).Decode(&result) != nil || result.ID == "" {
		resp.Body.Close()
		atomic.AddInt64(&m.outageErrors, 1)
		fmt.Fprintf(os.Stderr, "load outage start returned %d\n", resp.StatusCode)
		return
	}
	resp.Body.Close()
	if wait := time.Until(end); wait > 0 {
		time.Sleep(wait)
	}
	recoveredAt := time.Now()
	body, _ = json.Marshal(map[string]string{"recoveredAt": recoveredAt.Format(time.RFC3339Nano)})
	resp, err = authorized(c, http.MethodPost, strings.TrimRight(base, "/")+"/internal/v1/outages/"+result.ID+"/recover", token, body)
	if err != nil {
		atomic.AddInt64(&m.outageErrors, 1)
		fmt.Fprintf(os.Stderr, "load outage recovery failed: %v\n", err)
		return
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		atomic.AddInt64(&m.outageErrors, 1)
		fmt.Fprintf(os.Stderr, "load outage recovery returned %d\n", resp.StatusCode)
	}
}

func sameState(a, b sim.State) bool {
	left, errLeft := json.Marshal(a)
	right, errRight := json.Marshal(b)
	return errLeft == nil && errRight == nil && bytes.Equal(left, right)
}

func authorized(c *http.Client, method, url, token string, body []byte) (*http.Response, error) {
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return c.Do(req)
}

func uuid() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	s := hex.EncodeToString(b)
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}
func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return value
}
func envInt64(key string, fallback int64) int64 {
	value, err := strconv.ParseInt(os.Getenv(key), 10, 64)
	if err != nil {
		return fallback
	}
	return value
}
func envFloat(key string, fallback float64) float64 {
	value, err := strconv.ParseFloat(os.Getenv(key), 64)
	if err != nil {
		return fallback
	}
	return value
}
func envDuration(key string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return value
}
