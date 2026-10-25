import logging
import os

HOME = os.environ["HOME"]
USER = "deck"
DECKY_VERSION = "v0.0.0-sim"
DECKY_USER = "deck"
DECKY_USER_HOME = os.environ["HOME"]
DECKY_HOME = os.path.join(DECKY_USER_HOME, "homebrew")
DECKY_PLUGIN_SETTINGS_DIR = os.path.join(DECKY_HOME, "settings", "vaportype")
DECKY_PLUGIN_RUNTIME_DIR = os.path.join(DECKY_HOME, "data", "vaportype")
DECKY_PLUGIN_LOG_DIR = os.path.join(DECKY_HOME, "logs", "vaportype")
for d in (DECKY_PLUGIN_SETTINGS_DIR, DECKY_PLUGIN_RUNTIME_DIR, DECKY_PLUGIN_LOG_DIR):
    os.makedirs(d, exist_ok=True)
logging.basicConfig(level=logging.INFO, format="backend: %(message)s")
logger = logging.getLogger("vaportype")
