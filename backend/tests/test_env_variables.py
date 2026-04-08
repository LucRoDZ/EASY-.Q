"""Test that all environment variables are documented in .env.example"""

import os
import re
from pathlib import Path


def test_all_env_vars_documented():
    """Verify that all env vars used in config.py are documented in .env.example"""

    # Read config.py to find all os.getenv() calls
    config_path = Path(__file__).parent.parent / "app" / "config.py"
    with open(config_path, "r") as f:
        config_content = f.read()

    # Extract all environment variable names from os.getenv("VAR_NAME", ...)
    env_vars_in_code = set(re.findall(r'os\.getenv\("([^"]+)"', config_content))

    # Read .env.example
    env_example_path = Path(__file__).parent.parent / ".env.example"
    with open(env_example_path, "r") as f:
        env_example_content = f.read()

    # Extract all documented variables (lines that start with VAR_NAME=)
    documented_vars = set()
    for line in env_example_content.split("\n"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            var_name = line.split("=")[0].strip()
            documented_vars.add(var_name)

    # Check that all used variables are documented
    missing_vars = env_vars_in_code - documented_vars

    # Handle known aliases (GOOGLE_API_KEY is documented, GEMINI_API_KEY is alternative)
    # The test passes if either is documented
    known_aliases = {
        "GOOGLE_API_KEY": ["GEMINI_API_KEY"],
    }

    actually_missing = set()
    for var in missing_vars:
        # Check if this variable or any of its aliases is documented
        aliases = known_aliases.get(var, [])
        if not any(alias in documented_vars for alias in aliases):
            actually_missing.add(var)

    assert not actually_missing, (
        f"Environment variables used in config.py but not documented in .env.example:\n"
        f"{sorted(actually_missing)}\n\n"
        f"Please add these variables to backend/.env.example with proper documentation."
    )


def test_env_example_has_comments():
    """Verify that .env.example has helpful comments for each section"""

    env_example_path = Path(__file__).parent.parent / ".env.example"
    with open(env_example_path, "r") as f:
        content = f.read()

    # Check for section headers
    required_sections = [
        "Database",
        "Redis",
        "Authentication",
        "AI",
        "Payment",
        "Email",
        "Storage",
        "CORS",
    ]

    for section in required_sections:
        assert section in content, (
            f"Section '{section}' not found in .env.example. "
            f"Please add proper section headers with documentation."
        )


def test_critical_vars_documented():
    """Verify that critical production variables are documented"""

    env_example_path = Path(__file__).parent.parent / ".env.example"
    with open(env_example_path, "r") as f:
        content = f.read()

    critical_vars = [
        "DATABASE_URL",
        "REDIS_URL",
        "GOOGLE_API_KEY",
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "RESEND_API_KEY",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "CORS_ORIGINS",
        "FRONTEND_URL",
    ]

    for var in critical_vars:
        # Check that the variable is present AND has a comment explaining it
        assert f"{var}=" in content, f"Critical variable {var} not found in .env.example"

        # Find the line with this variable
        lines = content.split("\n")
        var_line_idx = next(i for i, line in enumerate(lines) if line.startswith(f"{var}="))

        # Check that there's a comment within 5 lines before this variable
        has_comment = False
        for i in range(max(0, var_line_idx - 5), var_line_idx):
            if lines[i].strip().startswith("#") and not lines[i].strip().startswith("#==="):
                has_comment = True
                break

        assert has_comment, (
            f"Variable {var} should have a descriptive comment explaining its purpose"
        )


def test_no_sensitive_values_in_example():
    """Verify that .env.example doesn't contain actual secrets"""

    env_example_path = Path(__file__).parent.parent / ".env.example"
    with open(env_example_path, "r") as f:
        content = f.read()

    # Patterns that indicate real secrets (not placeholders)
    forbidden_patterns = [
        r"sk_live_\w{20,}",  # Stripe live secret key
        r"pk_live_\w{20,}",  # Stripe live publishable key
        r"whsec_\w{20,}",     # Stripe webhook secret
        r"re_[A-Za-z0-9]{20,}",  # Resend API key
        r"AIza[A-Za-z0-9_-]{30,}",  # Real Google API key
    ]

    for pattern in forbidden_patterns:
        matches = re.findall(pattern, content)
        assert not matches, (
            f"Found what looks like a real secret in .env.example: {matches}\n"
            f"Please use placeholder values (sk_test_..., AIza..., etc.)"
        )
