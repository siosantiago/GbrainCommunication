"""Configuration for GBrain's Clawvisor connection."""

import os
from dataclasses import dataclass


@dataclass
class ClawvisorConfig:
    url: str
    agent_token: str

    @classmethod
    def from_env(cls) -> "ClawvisorConfig":
        url = os.environ.get("CLAWVISOR_URL", "").rstrip("/")
        token = os.environ.get("CLAWVISOR_AGENT_TOKEN", "")
        if not url:
            raise EnvironmentError(
                "CLAWVISOR_URL not set. Export it or add it to your shell profile.\n"
                "  export CLAWVISOR_URL='https://app.clawvisor.com'"
            )
        if not token:
            raise EnvironmentError(
                "CLAWVISOR_AGENT_TOKEN not set. Get it from the Clawvisor dashboard → Agents.\n"
                "  export CLAWVISOR_AGENT_TOKEN='cvis_...'"
            )
        return cls(url=url, agent_token=token)

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.agent_token}",
            "Content-Type": "application/json",
        }
