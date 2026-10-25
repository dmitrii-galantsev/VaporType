import glob
import json
import lzma
import math
import os
import re
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
INPUTS = os.path.join(DATA, "inputs")
SPELL_LISTS = ["/usr/share/dict/american-english", "/usr/share/dict/british-english"]
HUNSPELL = "/usr/share/hunspell/en_US.dic"
WORDS_OUT = os.environ.get("OSK_WORDS_OUT", os.path.join(DATA, "words.js"))
LM_OUT = os.environ.get("OSK_LM_OUT", os.path.join(DATA, "lm.js"))
CHAT_COUNTS = os.environ.get("OSK_CHAT_COUNTS", os.path.join(INPUTS, "chat-bigrams.txt"))
WORDFREQ = os.environ.get("OSK_WORDFREQ", "1") == "1"
SCOWL_LEVELS = os.path.join(INPUTS, "scowl-levels.txt.xz")
SCOWL_IMPORT = os.environ.get("OSK_SCOWL_IMPORT")
SCOWL_MAX = int(os.environ.get("OSK_SCOWL_MAX", 50))
PRIOR_A = float(os.environ.get("OSK_PRIOR_A", 3.4))
PRIOR_B = float(os.environ.get("OSK_PRIOR_B", 0.35))
CORPUS_SCALE = float(os.environ.get("OSK_CORPUS_SCALE", 0.25))
LEVEL_RANK = {10: 0, 20: 1, 35: 2, 40: 3, 50: 4, 55: 5, 60: 6, 70: 7}
CORPUS_LINES = [os.path.join(INPUTS, f) for f in ("chat-lines.txt.xz", "web-lines.txt.xz")]
LM_MASS = float(os.environ.get("OSK_LM_MASS", 0.22))
ROW_SMOOTH = float(os.environ.get("OSK_ROW_SMOOTH", 20))
WEB_COUNTS = os.environ.get("OSK_WEB_COUNTS", os.path.join(INPUTS, "web-bigrams.txt"))
WEB_WEIGHT = float(os.environ.get("OSK_WEB_WEIGHT", 0.3))

TOP_N = 200000
MIN_ZIPF = {3: 3.0, 4: 2.8, 5: 2.6}
MIN_ZIPF_LONG = float(os.environ.get("OSK_MIN_ZIPF_LONG", 2.3))
MIN_PROPER_ZIPF = 3.3
PHRASE_PENALTY = 0.3
PROPER_PENALTY = 0.3
PREFER_CAPS = set(
    """
english french german spanish italian russian dutch greek polish swedish irish scottish welsh portuguese japan china
john joe mike tom dan sam ben jim tim steve bob jack christian catholic jewish muslim european american
""".split()
)
MAX_PHRASES = int(os.environ.get("OSK_MAX_PHRASES", 2200))
MAX_BIGRAMS = int(os.environ.get("OSK_MAX_BIGRAMS", 150000))
MIN_PHRASE_WORD_ZIPF = 4.6
MIN_PHRASE_ZIPF = 2.8

word_re = re.compile(r"^[a-z]+(?:'[a-z]+)?$")

SHORT_OK = set(
    """
a i u am an as at be by do go he hi if in is it me my no of oh ok on or so to up us we ah aw eh ha ho uh um yo ye ow
ad ex id tv pc pm ps hp xp gg wp gl hf ty np ur ya fr rn op ai ez gj bf gf dm ui vr ko jk ig ff
""".split()
)

SLANG = {
    "lol": 4.8,
    "lmao": 4.5,
    "lmfao": 3.8,
    "rofl": 3.4,
    "lul": 3.0,
    "kek": 3.0,
    "xd": 3.8,
    "haha": 4.6,
    "hahaha": 4.0,
    "hah": 3.6,
    "heh": 3.6,
    "hehe": 3.8,
    "lolol": 3.0,
    "ha": 4.4,
    "idk": 4.4,
    "idc": 3.6,
    "tbh": 4.2,
    "ngl": 3.8,
    "imo": 4.0,
    "imho": 3.6,
    "omg": 4.5,
    "omw": 3.8,
    "brb": 3.9,
    "btw": 4.2,
    "afk": 3.9,
    "gg": 4.3,
    "ggs": 3.6,
    "wp": 3.6,
    "gl": 3.6,
    "hf": 3.3,
    "glhf": 3.4,
    "ez": 3.8,
    "gj": 3.4,
    "ty": 4.2,
    "thx": 4.0,
    "tysm": 3.5,
    "tyvm": 3.0,
    "np": 4.0,
    "pls": 4.2,
    "plz": 4.0,
    "ok": 5.4,
    "okay": 5.3,
    "kk": 3.8,
    "yeah": 5.6,
    "yea": 4.4,
    "yep": 4.5,
    "yup": 4.3,
    "nah": 4.5,
    "nope": 4.3,
    "gonna": 5.0,
    "wanna": 4.8,
    "gotta": 4.7,
    "kinda": 4.5,
    "sorta": 3.8,
    "dunno": 4.0,
    "lemme": 4.0,
    "gimme": 3.9,
    "ya": 4.4,
    "u": 4.8,
    "ur": 4.3,
    "bro": 4.6,
    "bruh": 4.2,
    "dude": 4.6,
    "fr": 3.9,
    "rn": 3.9,
    "irl": 3.6,
    "lmk": 3.7,
    "smh": 3.8,
    "wtf": 4.4,
    "wth": 3.4,
    "ffs": 3.6,
    "nvm": 3.8,
    "ikr": 3.6,
    "jk": 3.9,
    "ig": 3.5,
    "istg": 3.2,
    "sus": 3.9,
    "noob": 4.0,
    "noobs": 3.5,
    "nerf": 3.6,
    "nerfed": 3.4,
    "nerfs": 3.2,
    "buff": 3.9,
    "buffed": 3.5,
    "buffs": 3.5,
    "op": 4.0,
    "meta": 4.0,
    "lag": 3.9,
    "laggy": 3.6,
    "lagging": 3.6,
    "ping": 3.8,
    "respawn": 3.4,
    "respawned": 3.0,
    "teammate": 3.7,
    "teammates": 3.7,
    "queue": 4.0,
    "queued": 3.5,
    "queueing": 3.3,
    "omfg": 3.3,
    "pog": 3.4,
    "poggers": 3.3,
    "pogchamp": 3.0,
    "based": 4.4,
    "cringe": 4.0,
    "ratio": 4.0,
    "goated": 3.2,
    "mid": 4.0,
    "lowkey": 3.8,
    "highkey": 3.2,
    "deadass": 3.4,
    "bet": 4.4,
    "cap": 4.0,
    "fam": 3.8,
    "yall": 3.0,
    "y'all": 4.2,
    "ain't": 4.6,
    "aint": 3.0,
    "tho": 4.2,
    "thru": 3.8,
    "cuz": 3.9,
    "coz": 3.3,
    "cos": 3.5,
    "bc": 3.6,
    "rly": 3.3,
    "srsly": 3.0,
    "msg": 3.6,
    "dm": 3.9,
    "dms": 3.6,
    "ppl": 3.8,
    "pic": 4.0,
    "pics": 4.0,
    "vid": 3.7,
    "vids": 3.4,
    "gf": 3.6,
    "bf": 3.6,
    "bff": 3.5,
    "fyi": 3.8,
    "asap": 4.0,
    "tmrw": 3.4,
    "tmr": 3.0,
    "tonite": 3.0,
    "nite": 3.2,
    "gn": 3.4,
    "gm": 3.4,
    "wyd": 3.4,
    "hbu": 3.2,
    "wbu": 3.0,
    "hmu": 3.3,
    "ily": 3.4,
    "omgg": 2.8,
    "ugh": 4.2,
    "hmm": 4.3,
    "hmmm": 3.8,
    "uh": 4.3,
    "um": 4.3,
    "umm": 3.8,
    "uhh": 3.5,
    "oof": 3.8,
    "yikes": 3.8,
    "welp": 3.5,
    "meh": 3.9,
    "ew": 3.6,
    "eww": 3.4,
    "aww": 3.9,
    "awww": 3.3,
    "yay": 4.1,
    "woo": 3.7,
    "woohoo": 3.4,
    "wow": 4.9,
    "whoa": 4.0,
    "woah": 3.7,
    "damn": 4.8,
    "dang": 3.8,
    "darn": 3.6,
    "shit": 4.9,
    "fuck": 4.8,
    "fucking": 4.8,
    "fucked": 4.2,
    "crap": 4.2,
    "hell": 4.9,
    "bs": 3.6,
    "gtfo": 3.3,
    "stfu": 3.4,
    "af": 3.8,
    "asf": 3.0,
    "imma": 3.9,
    "finna": 3.3,
    "tryna": 3.6,
    "outta": 4.0,
    "lotta": 3.6,
    "ima": 3.3,
    "gotcha": 3.9,
    "ofc": 3.6,
    "obv": 3.3,
    "obvi": 3.0,
    "prob": 3.6,
    "probs": 3.3,
    "def": 3.6,
    "legit": 4.0,
    "lit": 4.2,
    "fire": 4.9,
    "vibe": 4.0,
    "vibes": 3.9,
    "vibing": 3.4,
    "salty": 3.8,
    "toxic": 4.1,
    "tryhard": 3.2,
    "sweaty": 3.4,
    "camping": 4.0,
    "camper": 3.5,
    "griefing": 3.2,
    "carry": 4.8,
    "carried": 4.6,
    "clutch": 3.9,
    "ace": 4.1,
    "headshot": 3.4,
    "oneshot": 3.0,
    "spawn": 3.8,
    "spawned": 3.3,
    "spawns": 3.3,
    "spawning": 3.3,
    "loot": 3.9,
    "looted": 3.3,
    "lobby": 3.9,
    "lobbies": 3.3,
    "matchmaking": 3.4,
    "ranked": 4.1,
    "unranked": 3.1,
    "mmr": 3.2,
    "elo": 3.4,
    "dps": 3.5,
    "tank": 4.4,
    "healer": 3.5,
    "heals": 3.5,
    "support": 5.2,
    "jungle": 4.2,
    "bot": 4.2,
    "bots": 4.0,
    "boss": 4.6,
    "bosses": 3.8,
    "raid": 4.0,
    "raids": 3.6,
    "dungeon": 3.8,
    "quest": 4.2,
    "quests": 3.7,
    "grind": 3.9,
    "grinding": 3.8,
    "farm": 4.6,
    "farming": 4.3,
    "xp": 3.6,
    "lvl": 3.3,
    "lvls": 2.8,
    "dlc": 3.6,
    "fps": 3.7,
    "hp": 3.9,
    "mana": 3.6,
    "cooldown": 3.5,
    "ult": 3.3,
    "ulti": 2.9,
    "aggro": 3.3,
    "kite": 3.6,
    "gank": 3.1,
    "ganked": 3.0,
    "rekt": 3.3,
    "pwned": 3.0,
    "owned": 4.5,
    "nub": 3.0,
    "scrub": 3.6,
    "hacker": 3.7,
    "hackers": 3.7,
    "hacks": 3.6,
    "cheater": 3.5,
    "cheaters": 3.4,
    "aimbot": 3.1,
    "wallhack": 2.8,
    "glitch": 3.8,
    "glitched": 3.3,
    "bugged": 3.4,
    "patch": 4.2,
    "patched": 3.5,
    "update": 4.9,
    "server": 4.6,
    "servers": 4.3,
    "disconnect": 3.5,
    "disconnected": 3.7,
    "dc": 3.8,
    "dced": 3.0,
    "reconnect": 3.4,
    "rejoin": 3.2,
    "invite": 4.4,
    "inv": 3.3,
    "party": 5.1,
    "squad": 4.2,
    "duo": 3.9,
    "solo": 4.3,
    "coop": 3.5,
    "pvp": 3.6,
    "pve": 3.3,
    "mob": 4.0,
    "mobs": 3.6,
    "npc": 3.5,
    "npcs": 3.3,
    "gameplay": 3.9,
    "playthrough": 3.3,
    "speedrun": 3.2,
    "steamdeck": 3.0,
    "controller": 4.2,
    "joystick": 3.5,
    "trackpad": 3.4,
    "keybind": 3.0,
    "keybinds": 3.0,
    "settings": 4.6,
    "fov": 3.2,
    "vsync": 3.0,
    "framerate": 3.3,
    "stutter": 3.4,
    "stuttering": 3.4,
    "crash": 4.4,
    "crashed": 4.0,
    "crashing": 3.7,
    "afking": 2.9,
    "gtg": 3.5,
    "ttyl": 3.4,
    "cya": 3.6,
    "bye": 4.7,
    "byee": 3.0,
    "hiya": 3.4,
    "heya": 3.3,
    "hey": 5.3,
    "hiii": 3.0,
    "sup": 4.0,
    "yo": 4.4,
    "thanks": 5.5,
    "thank": 5.3,
    "sorry": 5.3,
    "sry": 3.4,
    "mb": 3.6,
    "my": 6.7,
    "wym": 3.4,
    "wdym": 3.3,
    "idek": 3.0,
    "tldr": 3.4,
    "nsfw": 3.6,
    "otp": 3.0,
    "ftw": 3.6,
    "bday": 3.6,
    "congrats": 4.4,
    "grats": 3.2,
    "gz": 3.0,
    "gratz": 3.0,
    "ggwp": 3.3,
    "yessir": 3.3,
    "yesss": 3.2,
    "noo": 3.6,
    "nooo": 3.4,
    "yess": 3.3,
    "okk": 2.9,
    "okie": 3.3,
    "oki": 3.0,
    "alright": 4.8,
    "aight": 3.4,
    "ight": 3.2,
    "alr": 3.2,
    "sure": 5.5,
    "wait": 5.3,
    "true": 5.3,
    "same": 5.6,
    "mood": 4.6,
    "facts": 4.4,
    "periodt": 2.9,
    "slay": 3.9,
    "simp": 3.5,
    "stan": 4.0,
    "rizz": 3.4,
    "cracked": 3.9,
    "goat": 4.4,
    "yeet": 3.4,
    "bussin": 3.0,
    "sheesh": 3.6,
    "bruv": 3.2,
    "mate": 4.6,
    "innit": 3.3,
    "cheers": 4.4,
    "cba": 3.0,
    "tbf": 3.5,
    "afaik": 3.4,
    "iirc": 3.4,
    "ime": 3.0,
    "ymmv": 3.0,
    "ama": 3.4,
    "til": 3.6,
    "edit": 4.7,
    "upvote": 3.4,
    "downvote": 3.2,
    "subreddit": 3.4,
    "reddit": 4.2,
    "discord": 4.0,
    "twitch": 4.0,
    "stream": 4.8,
    "streaming": 4.5,
    "streamer": 3.9,
    "streamers": 3.6,
    "emote": 3.3,
    "emotes": 3.3,
    "emoji": 3.8,
    "meme": 4.2,
    "memes": 4.1,
    "lurk": 3.4,
    "lurking": 3.4,
    "mod": 4.1,
    "mods": 4.1,
    "modded": 3.4,
    "modding": 3.3,
    "gpu": 3.9,
    "cpu": 4.0,
    "ssd": 3.8,
    "ram": 4.2,
    "wifi": 4.2,
    "bluetooth": 3.9,
    "headset": 3.8,
    "mic": 4.0,
    "muted": 3.7,
    "unmute": 3.2,
    "unmuted": 3.0,
    "lagged": 3.2,
    "rq": 3.2,
    "nw": 3.4,
    "yw": 3.4,
    "ttys": 2.8,
    "bbl": 3.0,
    "bbiab": 2.7,
}

BRANDS = {
    "discord": "Discord",
    "steam": "Steam",
    "twitch": "Twitch",
    "youtube": "YouTube",
    "reddit": "Reddit",
    "google": "Google",
    "netflix": "Netflix",
    "spotify": "Spotify",
    "xbox": "Xbox",
    "playstation": "PlayStation",
    "nintendo": "Nintendo",
    "valve": "Valve",
    "iphone": "iPhone",
    "android": "Android",
    "linux": "Linux",
    "windows": "Windows",
    "minecraft": "Minecraft",
    "fortnite": "Fortnite",
    "github": "GitHub",
}

BLOCK = set(
    """
nigger niggers nigga niggas faggot faggots fag fags chink chinks coon coons dyke dykes retard retards retarded tranny
trannies kike kikes spic spics wetback wetbacks gook gooks
iii vii viii xii xiii xiv xvi xvii xviii xix xxi xxx inc est vol ins eds int ind tel mar cal col gov hrs lbs tsp tbs
pct adv hwy avg mpg ftp gnu asp nos mos tat cis ani wen lam ode mes ifs ism aft hoc pas mas ova viz sic ere fer yrs
wot dis dos cox sox lea pol vie lei tor var sod jun aug oct nov dec feb apr sep sept thu thurs tues
""".split()
)
FORCE_CONTRACT = set("hes shes wheres whos hows whys theres heres thats whats".split())

CASE = {"i": "I", "i'm": "I'm", "i've": "I've", "i'll": "I'll", "i'd": "I'd"}

PRON_S = "he she it there here that what who where when why how everyone everybody someone somebody nobody let".split()
PRON_RE = "you we they there what who".split()
PRON_VE = "i you we they who would could should might must there".split()
PRON_LL = "i you we they he she it there that who what".split()
PRON_D = "i you we they he she it there that who what where how why".split()
NEG = "do does did is are was were have has had could would should must might need ca wo ai sha dare".split()


def contraction_table():
    out = set()
    out.update(p + "'s" for p in PRON_S)
    out.update(p + "'re" for p in PRON_RE)
    out.update(p + "'ve" for p in PRON_VE)
    out.update(p + "'ll" for p in PRON_LL)
    out.update(p + "'d" for p in PRON_D)
    out.add("i'm")
    out.update(n + "n't" for n in NEG)
    out.update(["y'all", "ma'am", "o'clock"])
    return out


CONTRACTIONS = contraction_table()

ITS_NEXT = set(
    """
a an not the just been so time all only very too really like ok okay good going getting hard fine about always pretty
actually still also never gonna funny over true my your our their that this what because nice great weird cool
""".split()
)
LETS_NEXT = set(
    """
go see get do be talk make just play have start try take hope face look not say all keep put move eat find
think play pray dance chat hang meet begin assume call
""".split()
)
ILL_NEXT = set(
    """
be have go never try get do take make just see need let send post check give tell keep bring probably definitely write
add look show put call still always also show stop wait leave buy come find start think pass update sleep
""".split()
)
ID_NEXT = set("like love be rather have say never recommend suggest probably been go prefer do appreciate think want need".split())

PHRASE_JUNK = set(
    """
click here posted by privacy policy copyright reserved rights page pages site website online http www com search results
email view add cart free download shipping price prices item items read more next previous home contact information
reply comments comment links link post posts terms conditions product products buy sale related user users login
register account forum forums member members file files version sign rating reviews review report reports
quote message messages print articles article news total data inc llc ltd per usd pm am new used use please
shop ship orders order store stores larger details image images rated recent join profile section subject credit
charge reserve invite offer offers provide accept include apply exist limited edit listed reflect vote below full
receive request select enter visit shall
""".split()
)

STARTERS = set(
    """
i i'm i've i'll i'd you you're you'll we're they're it's that's what's let's don't can't didn't won't isn't thank
thanks see good nice oh yes yeah no ok okay so too very really just how what why my love miss hope come go got kind
sort lot pretty sounds makes
""".split()
)
WEAK_SECOND = set("the a an and or of is are was were as by from at with for to in on".split())
ENDERS = set("you it me up now too again there here done good fine sure back out down later soon though".split())

CHAT_PHRASES = """
I'm done
I'm good
I'm fine
I'm here
I'm back
I'm ready
I'm down
I'm in
I'm out
I'm sorry
I'm sure
I'm not
I'm going
I'm gonna
I'm on
I'm coming
I'm tired
I'm home
I'm busy
I'm dead
I'm lost
I am
I was
I will
I can
I can't
I don't
I didn't
I think
I know
I guess
I mean
I see
I agree
I'll be
I'll go
I'll try
I've been
I'd say
I don't know
I don't think
I love you
I miss you
I got it
thank you
thanks man
thanks bro
thanks again
no thanks
let's go
let's play
let's do it
on my way
good game
good luck
good night
good morning
well played
nice one
nice try
see you
see ya
no problem
no worries
no way
of course
what's up
what's that
you know
you too
you good
you there
right now
kind of
sort of
a lot
a bit
for sure
for real
oh well
oh no
oh yeah
oh my god
oh wait
all good
all right
my bad
my turn
hold on
one sec
one moment
hang on
wait up
come on
go ahead
never mind
not sure
not yet
not really
me too
same here
how are you
how's it going
are you
are you there
did you
do you
can you
will do
sounds good
makes sense
got it
good one
too bad
so good
so much
very good
see you later
talk later
later guys
be right back
just kidding
just a sec
just now
in a bit
on it
it's fine
it's ok
it's okay
that's it
that's right
that's fine
that's good
that's true
that's funny
don't know
don't worry
don't care
didn't know
gg wp
gg ez
nice shot
nice play
last one
one more
one more game
play again
ready up
let me know
wait for me
follow me
help me
cover me
behind you
watch out
over here
over there
""".strip().split("\n")

CHAT_BIGRAMS = """
gg wp
gg ez
gg guys
good game
lol yeah
lol ok
lol no
lol that
yeah lol
yeah i'm
i'm done
i'm down
i'm dead
i'm back
i'm ready
i'm gonna
brb gonna
omw now
nice shot
nice one
my bad
ty for
thx for
np bro
ok cool
ok lol
okay cool
sounds good
oh nice
oh wow
wow nice
haha yeah
lmao that
bruh moment
let's go
lets go
on my
gonna be
wanna play
gotta go
idk what
idk lol
no worries
same here
wait what
what lol
hold on
one sec
i'm in
im in
fr fr
""".strip().split("\n")


def load_spelling():
    exact = set()
    for path in SPELL_LISTS:
        with open(path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                exact.add(line.strip())
    with open(HUNSPELL, encoding="utf-8", errors="ignore") as f:
        next(f)
        for line in f:
            w = line.strip().split("/")[0]
            if len(w) >= 4:
                exact.add(w)
    lower = {w for w in exact if w == w.lower()}
    cased = {}
    for w in sorted(exact):
        if w != w.lower():
            cased.setdefault(w.lower(), w)
    caps = {}
    for k, w in cased.items():
        if k not in lower or k in PREFER_CAPS:
            caps[k] = w
    lower -= set(caps)
    return lower, caps


def letters(w):
    s = ""
    for ch in w.lower():
        if "a" <= ch <= "z" and (not s or ch != s[-1]):
            s += ch
    return s


def import_scowl(src):
    best = {}
    for path in sorted(glob.glob(os.path.join(src, "final", "*"))):
        cat, _, lv = os.path.basename(path).rpartition(".")
        if not lv.isdigit() or int(lv) > 70:
            continue
        m = re.match(r"^(english|american|british)-(words|contractions|upper|proper-names)$", cat)
        if not m:
            continue
        with open(path, encoding="latin-1") as f:
            for line in f:
                w = line.strip()
                if w and (w not in best or int(lv) < best[w][0]):
                    best[w] = (int(lv), m.group(2))
    with lzma.open(SCOWL_LEVELS, "wt", encoding="utf-8", preset=9) as f:
        for w in sorted(best):
            f.write(f"{w}\t{best[w][0]}\t{best[w][1]}\n")
    print(f"wrote {SCOWL_LEVELS}: {len(best)} entries")


def load_scowl():
    out = {}
    with lzma.open(SCOWL_LEVELS, "rt", encoding="utf-8") as f:
        for line in f:
            w, lv, cat = line.rstrip("\n").split("\t")
            out[w] = (int(lv), cat)
    return out


def corpus_counts():
    tok = re.compile(r"[a-z]+(?:'[a-z]+)?")
    counts = Counter()
    for path in CORPUS_LINES:
        with lzma.open(path, "rt", encoding="utf-8") as f:
            for line in f:
                counts.update(tok.findall(line.lower()))
    return counts, sum(counts.values())


def build_words_permissive():
    scowl = load_scowl()
    counts, total = corpus_counts()
    lower = {}
    cased = {}
    for w, (lv, cat) in sorted(scowl.items()):
        k = w.lower()
        if w == k and cat in ("words", "contractions"):
            lower[k] = min(lv, lower.get(k, 99))
        elif w != k:
            if k not in cased or lv < cased[k][1]:
                cased[k] = (w, lv)
    caps = {k: w for k, (w, lv) in cased.items() if k not in lower or k in PREFER_CAPS}
    level = dict(lower)
    for k, (_w, lv) in cased.items():
        level[k] = min(lv, level.get(k, 99))

    def zipf(k):
        lv = level.get(k)
        est = CORPUS_SCALE * counts[k] / total * 1e9 + (10 ** (PRIOR_A - PRIOR_B * LEVEL_RANK[lv]) if lv in LEVEL_RANK else 0)
        return math.log10(est) if est > 0 else -9

    stripped_drop = {c.replace("'", "") for c in CONTRACTIONS} - (set(lower) - FORCE_CONTRACT)
    words = {}
    proper = set()
    for k in sorted(set(level) | CONTRACTIONS):
        if not word_re.match(k) or k in stripped_drop or k in BLOCK:
            continue
        if level.get(k, 99) > SCOWL_MAX and k not in CONTRACTIONS:
            continue
        z = zipf(k)
        if z < MIN_ZIPF_LONG or (z < MIN_ZIPF.get(len(k), MIN_ZIPF_LONG) and k not in SLANG and k not in BRANDS):
            continue
        if len(k) <= 2 and k not in SHORT_OK:
            continue
        if k in CONTRACTIONS or k in lower:
            words[k] = z
        elif k in caps and z >= MIN_PROPER_ZIPF:
            words[k] = z - PROPER_PENALTY
            proper.add(k)
    for w in BRANDS:
        z = zipf(w)
        if z >= MIN_ZIPF_LONG:
            words[w] = max(words.get(w, 0), z)
    return finish_words(words, proper, caps, lower, stripped_drop)


def finish_words(words, proper, caps, lower, stripped_drop):
    for w, floor in SLANG.items():
        if w in stripped_drop:
            continue
        words[w] = max(words.get(w, 0), floor) if w in lower else floor
        proper.discard(w)
    for w in BRANDS:
        if w in words:
            proper.discard(w)
    display = {}
    for w in words:
        if w in CASE:
            display[w] = CASE[w]
        elif w in BRANDS:
            display[w] = BRANDS[w]
        elif w in proper:
            display[w] = caps[w]
        else:
            display[w] = w
    return words, display, stripped_drop


def build_words(lower, caps):
    from wordfreq import top_n_list, zipf_frequency

    stripped_drop = {c.replace("'", "") for c in CONTRACTIONS} - (lower - FORCE_CONTRACT)
    words = {}
    proper = set()
    for w in top_n_list("en", TOP_N):
        if not word_re.match(w):
            continue
        z = zipf_frequency(w, "en")
        if z < MIN_ZIPF_LONG:
            break
        if z < MIN_ZIPF.get(len(w), MIN_ZIPF_LONG) and w not in SLANG and w not in BRANDS:
            continue
        if w in stripped_drop or w in BLOCK:
            continue
        if len(w) <= 2 and w not in SHORT_OK:
            continue
        if w in CONTRACTIONS or w in lower:
            words[w] = z
        elif w in caps and z >= MIN_PROPER_ZIPF:
            words[w] = z - PROPER_PENALTY
            proper.add(w)
        elif w in SLANG or w in BRANDS:
            words[w] = z
    return finish_words(words, proper, caps, lower, stripped_drop)


def map_bigram(a, b, drop_map):
    la, lb = a.lower(), b.lower()

    def fix(tok, low, nxt):
        if low in drop_map:
            return drop_map[low]
        if low in ("cant", "wont"):
            return low[:-1] + "'t"
        if low == "its" and nxt in ITS_NEXT:
            return "it's"
        if low == "lets" and nxt in LETS_NEXT:
            return "let's"
        if low == "ill" and (tok == "Ill" or nxt in ILL_NEXT):
            return "i'll"
        if low == "id" and tok == "Id" and nxt in ID_NEXT:
            return "i'd"
        return low

    return fix(a, la, lb), fix(b, lb, "")


def to_z(count):
    return math.log10(count)


def read_counts(path, words, drop_map):
    counts = defaultdict(int)
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            pair, _, c = line.rstrip("\n").partition("\t")
            parts = pair.split(" ")
            if len(parts) != 2 or not c:
                continue
            a, b = map_bigram(parts[0], parts[1], drop_map)
            if a in words and b in words:
                counts[(a, b)] += int(c)
    return counts


def count_total(path):
    total = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            total += int(line.rstrip("\n").rpartition("\t")[2] or 0)
    return total


def build_lm(words, stripped_drop):
    drop_map = {c.replace("'", ""): c for c in CONTRACTIONS if c.replace("'", "") in stripped_drop}
    pairs = read_counts(CHAT_COUNTS, words, drop_map)
    if WEB_WEIGHT:
        scale = WEB_WEIGHT * count_total(CHAT_COUNTS) / count_total(WEB_COUNTS)
        pairs = defaultdict(float, {k: c * (1 - WEB_WEIGHT) for k, c in pairs.items()})
        for k, c in read_counts(WEB_COUNTS, words, drop_map).items():
            pairs[k] += c * scale
    row = defaultdict(float)
    for (a, _), c in pairs.items():
        row[a] += c
    return {(a, b): 10 ** words[a] * c / (row[a] + ROW_SMOOTH) for (a, b), c in pairs.items()}, drop_map


def build_phrases(words, display, counts):
    phrases = {}
    word_keys = {}
    for w, z in words.items():
        k = letters(w)
        word_keys[k] = max(word_keys.get(k, 0), z)

    def disp(w):
        return display.get(w, w)

    for (a, b), c in sorted(counts.items(), key=lambda kv: -kv[1]):
        if len(phrases) >= MAX_PHRASES:
            break
        if a in PHRASE_JUNK or b in PHRASE_JUNK:
            continue
        if a not in STARTERS and b not in ENDERS:
            continue
        if a in WEAK_SECOND or b in WEAK_SECOND or to_z(c) - PHRASE_PENALTY < MIN_PHRASE_ZIPF:
            continue
        if disp(a) != a and a not in CASE or disp(b) != b and b not in CASE:
            continue
        if len(a) > 7 or len(b) > 7 or a == b:
            continue
        if min(words[a], words[b]) < MIN_PHRASE_WORD_ZIPF:
            continue
        if len(a) == 1 and a not in ("a", "i") or len(b) == 1 and b not in ("a", "i"):
            continue
        d = disp(a) + " " + disp(b)
        if word_keys.get(letters(d), 0) >= 2.0:
            continue
        phrases[d] = to_z(c) - PHRASE_PENALTY

    for d in CHAT_PHRASES:
        toks = d.lower().split(" ")
        if len(toks) < 2 or not all(t in words for t in toks):
            continue
        if word_keys.get(letters(d), 0) >= 2.0:
            continue
        pair_z = [to_z(counts[(x, y)]) for x, y in zip(toks, toks[1:], strict=False) if counts.get((x, y))]
        est = min(words[t] for t in toks) - 1.2 - 0.4 * (len(toks) - 2)
        if pair_z and len(toks) == 2:
            z = max(pair_z[0] - PHRASE_PENALTY, est)
        elif pair_z:
            z = max(min(pair_z) - PHRASE_PENALTY - 0.6, est)
        else:
            z = est
        z = min(max(z, 2.6), 4.6)
        key = " ".join(disp(t) for t in toks)
        phrases[key] = max(phrases.get(key, 0), z)
    return phrases


def write_js(path, var, version, source, lines):
    text = "\n".join(lines)
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"globalThis.{var} = {{ version: {version:d}, source: {json.dumps(source)}, text: {json.dumps(text)} }};\n")
    return os.path.getsize(path)


def main():
    if SCOWL_IMPORT:
        return import_scowl(SCOWL_IMPORT)
    if WORDFREQ:
        words, display, stripped_drop = build_words(*load_spelling())
    else:
        words, display, stripped_drop = build_words_permissive()
    counts, drop_map = build_lm(words, stripped_drop)
    for line in CHAT_BIGRAMS:
        a, b = line.split(" ")
        a = {"im": "i'm", "lets": "let's"}.get(a, a)
        if a in words and b in words:
            counts[(a, b)] = max(counts.get((a, b), 0), 10**2.3)
    phrases = build_phrases(words, display, counts)

    entries = [(display[w], z) for w, z in words.items()] + list(phrases.items())
    entries.sort(key=lambda e: (-round(e[1] * 10), e[0]))
    word_lines = [f"{d} {round(z * 10)}" for d, z in entries]
    pairs_src = "chat-bigrams.txt" + (" + web-bigrams.txt" if WEB_WEIGHT else "")
    if WORDFREQ:
        wsource = (
            f"wordfreq 3.1 en, CC BY-SA 4.0 (zipf >= {MIN_ZIPF_LONG:.1f}, higher for short words), filtered by /usr/share/dict + "
            f"hunspell en_US, curated chat slang, {len(phrases):d} phrases from {pairs_src} + curated; see DATA-LICENSES.md"
        )
    else:
        wsource = (
            f"SCOWL 2020.12.07 words up to size {SCOWL_MAX:d} (levels 70 and below only), frequencies counted from generated chat and web "
            f"lines (x {CORPUS_SCALE:g}) plus a SCOWL-level prior (zipf {PRIOR_A:g} - {PRIOR_B:g} per level step), curated chat slang, "
            f"{len(phrases):d} phrases from {pairs_src} + curated; see DATA-LICENSES.md"
        )
    wsize = write_js(WORDS_OUT, "__oskWords", 4 if WORDFREQ else 5, wsource, word_lines)

    top = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_BIGRAMS]
    lm_lines = [f"{a} {b} {z}" for (a, b), c in top if (z := round(10 * (to_z(c) + math.log10(LM_MASS)))) >= 0]
    source = (
        "chat-bigrams.txt"
        + (f" + web-bigrams.txt (weight {WEB_WEIGHT:g})" if WEB_WEIGHT else "")
        + " (pairs counted from lines generated by Qwen3.5-9B-Base), contractions restored, "
        f"z10 = 10*log10(per 1e9 tokens: {'wordfreq' if WORDFREQ else 'words.js'} frequency of the first word "
        f"x chat P(second | first) x {LM_MASS:g}); "
        "see DATA-LICENSES.md"
    )
    lsize = write_js(LM_OUT, "__oskLM", 4 if WORDFREQ else 5, source, lm_lines)

    print(f"words.js: {len(words)} words + {len(phrases)} phrases = {len(word_lines)} entries, {wsize} bytes")
    print(f"lm.js: {len(lm_lines)} bigrams, {lsize} bytes")
    zmap = {d.lower(): z for d, z in entries}
    for w in ["the", "I'm", "don't", "im", "dont", "ilm", "iom", "yaya", "salomon", "st", "lol", "gonna", "gg", "I'm done", "thank you"]:
        z = zmap.get(w.lower())
        print(f"  {w!r}: {'absent' if z is None else round(z, 2)}")
    kept = dict(top)
    out_tot = defaultdict(int)
    for (a, _b), c in kept.items():
        out_tot[a] += c
    for w1 in ["i'm", "thank", "good", "let's", "see"]:
        fol = sorted(((c, b) for (a, b), c in kept.items() if a == w1), reverse=True)[:5]
        print(f"  P(.|{w1}): " + ", ".join(f"{b} {c / out_tot[w1]:.2f}" for c, b in fol))


if __name__ == "__main__":
    main()
