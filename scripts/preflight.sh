#!/usr/bin/env bash
# Pre-flight: typecheck, tests, and the greps that must return nothing.
# Site knowledge belongs in a bot's skills (examples/, data/), never under src/.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm typecheck
pnpm test

# The in-sandbox companion is Python, so vitest cannot reach it. Its pure logic — the CDP message
# loop and the arm/disarm pairing around file-chooser interception — is tested with the standard
# library and needs nothing installed. Python 3 ships with macOS and Linux; if this machine has
# none, say so instead of failing, because everything else here still holds.
if command -v python3 > /dev/null 2>&1; then
  python3 -B -m unittest discover -s src/server/companion -p 'companion_test.py'  # -B: write no bytecode into src/
else
  echo "python3 not found: skipped the companion tests (they run inside the sandbox's Python too)"
fi

# One folder is exempt from the site-name and work-word checks below: a built-in connector in
# src/server/connectors/builtin/ names its service and uses that service's own terms, because it is
# an adapter for that service and serves every bot that uses it. Nothing outside that folder may.
# The history and date checks still cover it. (A path filter, not --exclude-dir, which would exempt
# a folder of that name anywhere under src/.)
BUILTIN_CONNECTORS='^src/server/connectors/builtin/'

if grep -rniE 'startupjobs|calendly|linkedin|jobs\.cz|seznam|gmail' src/ | grep -v "$BUILTIN_CONNECTORS"; then
  echo "site-specific code found under src/"
  exit 1
fi

# The platform boundary. The files under src/ are the platform: they serve every bot, so they hold
# nothing of one bot's work and nothing of this project's history.
RUNTIME=(--exclude='*.test.ts' --exclude='fakes.ts' --exclude='*_test.py')

# Words of the example bot's work, in a comment, a prompt or a tool description. Their place is the
# bot's own persona, memory and skills (examples/, data/bots/). Test files reproduce
# concrete scenarios, so they are left out of this check. Three words of the test's list are left
# out here on purpose: applied, application and interview. A grep cannot tell a comment or a MIME
# type from text the model reads, and those words occur in src/ as ordinary English
# ("application/json", "the interview" for the bot's questions about a new goal).
# src/server/agent/prompt.test.ts checks them against the exact text the model is given.
if grep -rnwiE "${RUNTIME[@]}" 'cvs?|cover letters?|dossiers?|postings?|job[- ]boards?|recruiters?|vacanc(y|ies)|applicants?|bookings?|booked|slots?|invitations?|shortlists?|schedule events?' src/ | grep -v "$BUILTIN_CONNECTORS"; then
  echo "words of one bot's work found in platform code under src/: use a neutral example, or move the text into the bot's skill"
  exit 1
fi

# Review names, rehearsal names and plan-task names, in any file under src/, tests included. A
# comment says what the code does now and why; how the reason was found belongs in docs/ and in the
# commit message.
if grep -rniE '\bact (one|two|three)\b|\bround [0-9]+\b|\bfinding [A-Z][0-9]?\b|\btask [0-9]+\b|\blive cycle\b|\breview(ed)? (of|finding)|\bcode review\b|\bcodex\b|\brehears|\bthe demo\b|\bdemo path\b|\bfilmed\b|\bside proof\b|\bseen live\b|\bfound live\b' src/; then
  echo "project history found under src/: state the reason in present tense, and keep the story in docs/ or the commit message"
  exit 1
fi

# A date in a runtime file. A path under docs/ may hold one; test files hold dates as test data.
# Some services name their API versions by date, so a built-in connector may hold one in a constant
# named *_VERSION; that exact form is the only date allowed.
API_VERSION_DATE="^src/server/connectors/builtin/[^:]+:[0-9]+:const [A-Z_]+_VERSION = '20[0-9]{2}-[0-9]{2}-[0-9]{2}'\$"
if grep -rnE "${RUNTIME[@]}" '(^|[^/0-9A-Za-z-])20[0-9]{2}-[0-9]{2}-[0-9]{2}' src/ | grep -vE "$API_VERSION_DATE"; then
  echo "a date found in platform code under src/: a comment describes the code as it is now; the date of a change is in the git log"
  exit 1
fi
echo "preflight ok"
