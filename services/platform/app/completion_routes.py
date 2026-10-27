from __future__ import annotations

import hashlib
import hmac
import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dependencies import get_economy_db
from app.economy.models import CompletionEvidence
from app.economy.settlement import enqueue_settlement
from app.schemas import (
    RunLifeCompleted,
)
from app.settings import Settings


def _payload_hash(event: RunLifeCompleted) -> tuple[dict[str, Any], str]:
    payload = event.model_dump(mode="json")
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return payload, hashlib.sha256(canonical.encode()).hexdigest()


def create_router(config: Settings) -> APIRouter:
    router = APIRouter()

    @router.post("/internal/v1/run-completions", status_code=202)
    def accept_completion(
        event: RunLifeCompleted,
        authorization: Annotated[str | None, Header()] = None,
        db: Session = Depends(get_economy_db),
    ) -> dict[str, str | bool]:
        expected = f"Bearer {config.service_token}"
        try:
            authorized = bool(authorization and hmac.compare_digest(authorization, expected))
        except TypeError:
            authorized = False
        if not authorized:
            raise HTTPException(status_code=401, detail="unauthorized")
        payload, digest = _payload_hash(event)
        identity_clause = or_(
            (CompletionEvidence.run_id == event.run_id) & (CompletionEvidence.life_index == event.life_index),
            CompletionEvidence.event_id == event.event_id,
        )
        previous = db.execute(select(CompletionEvidence).where(identity_clause).with_for_update()).scalars().all()
        if previous:
            if len(previous) != 1 or previous[0].payload_hash != digest:
                raise HTTPException(status_code=409, detail="completion evidence conflict")
            enqueue_settlement(db, previous[0], config)
            db.commit()
            return {"accepted": True, "event_id": str(previous[0].event_id), "duplicate": True}
        evidence = CompletionEvidence(
            event_id=event.event_id,
            run_id=event.run_id,
            life_index=event.life_index,
            payload=payload,
            payload_hash=digest,
        )
        db.add(evidence)
        try:
            db.flush()
            enqueue_settlement(db, evidence, config)
            db.commit()
        except IntegrityError:
            db.rollback()
            concurrent = db.execute(select(CompletionEvidence).where(identity_clause)).scalars().all()
            if len(concurrent) == 1 and concurrent[0].payload_hash == digest:
                enqueue_settlement(db, concurrent[0], config)
                db.commit()
                return {"accepted": True, "event_id": str(concurrent[0].event_id), "duplicate": True}
            raise HTTPException(status_code=409, detail="completion evidence conflict") from None
        return {"accepted": True, "event_id": str(event.event_id), "duplicate": False}

    return router
