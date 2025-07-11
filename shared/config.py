"""Shared configuration for TTCAN rating project."""
import os
from typing import Optional

def get_env_var(key: str, default: Optional[str] = None) -> str:
    """Get environment variable with optional default."""
    value = os.getenv(key, default)
    if value is None:
        raise ValueError(f"Environment variable {key} is required")
    return value

# TTCAN scraping configuration
TTCAN_BASE_URL = get_env_var("TTCAN_BASE_URL", "http://www.ttcan.ca/ratingSystem/ctta_ratings2.asp")
CATEGORY_CODE = get_env_var("CATEGORY_CODE", "1")
PERIOD_ISSUED = get_env_var("PERIOD_ISSUED", "412")
SEX = get_env_var("SEX", "F")

# Google Sheets configuration
GOOGLE_SHEET_ID = get_env_var("GOOGLE_SHEET_ID")
GOOGLE_SHEET_NAME = get_env_var("GOOGLE_SHEET_NAME", "Sheet1")
GOOGLE_SERVICE_ACCOUNT_FILE = get_env_var("GOOGLE_SERVICE_ACCOUNT_FILE")

# Google Sheets API scopes
GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]