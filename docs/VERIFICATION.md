# Verification assumptions

These notes describe evidence limits for simulation, controller and load-test
harnesses. Commands and routine checks are listed in the [root README](../README.md).

## Controller and simulation cases

Before expanding controller, simulation or load-test coverage, establish
representative cases that validate the harness. For a flight controller, specify
screen-edge visibility, observation/reaction timing, requested speed, entry
position and velocity, complete pickup criteria, and survival through the next
exit. For other harnesses, check applicable inputs, timing, workload and success
conditions, and state which assumptions do not apply.

Declare the required coverage matrix before searching or expanding cases. Retain
failures and report uncovered cells. Searching for successful examples can
establish a bounded witness, but cannot replace required failing cases or satisfy
coverage merely by showing that some example of each type passed.

Separate requirements from controller strategies and fixture assumptions. A
failed controller trace does not by itself prove impossible geometry. Diagnose
which assumption, strategy or product behavior failed and retain a reproducible
case. Do not weaken approved delay, visibility, speed, coverage or exit criteria
to get a pass. Harness corrections invalidate dependent results; rerun affected
cases and mark earlier evidence as superseded.

Bounded witnesses are bounded evidence, not universal reachability or proof of
human playability. Browser automation is not physical Telegram/mobile evidence;
see the [documentation map](README.md) for current acceptance records.
