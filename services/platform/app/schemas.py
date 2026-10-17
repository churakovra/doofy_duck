from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TelegramAuthRequest(BaseModel):
    init_data: str = Field(min_length=1, max_length=16_384)


class DevAuthRequest(BaseModel):
    telegram_user_id: int = Field(gt=0)


class AccessResponse(BaseModel):
    access_token: str
    token_type: Literal["Bearer"] = "Bearer"
    expires_in: int = 600


class AccountResponse(BaseModel):
    account_id: UUID
    telegram_user_id: int
    created_at: datetime


class Collections(BaseModel):
    model_config = ConfigDict(extra="forbid")
    FEATHER: int = Field(ge=0)
    GAME_STAR: int = Field(ge=0)


class RunLifeCompleted(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: UUID
    type: Literal["RunLifeCompleted.v1"]
    account_id: UUID
    run_id: UUID
    life_index: int = Field(ge=0)
    simulation_version: str = Field(min_length=1, max_length=32)
    generator_version: str = Field(min_length=1, max_length=32)
    config_id: str = Field(min_length=1, max_length=128)
    checkpoint_sequence: int = Field(ge=0)
    score: int = Field(ge=0)
    collections: Collections
    reason: Literal["death", "flight_cap"]
    completed_at: datetime

    @field_validator("completed_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("completed_at must include a timezone")
        return value
