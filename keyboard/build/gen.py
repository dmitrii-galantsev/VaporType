import json
import os
import random
import sys
import time

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = os.environ.get("GEN_MODEL", "Qwen/Qwen3.5-9B-Base")
OUT = sys.argv[1]
MINUTES = float(sys.argv[2])
BATCH = int(os.environ.get("GEN_BATCH", 96))
NEW = int(os.environ.get("GEN_NEW", 320))
SEED = int(os.environ.get("GEN_SEED", 1))

NAMES = """jake mia tyler zoe kev sam alex jordan riley casey nova pixel ghost viper frosty taco noodle bean max lily
ethan chloe dan emma nate ava luke ella owen grace leo ruby finn ivy cole sky jess matt tom ben amy kat rob nick
zack mel josh liz ryan beth chris dani milo nora theo lucy omar sara raj priya wei lin tomas ana marco jo kai
xXsniperXx dankmemer420 sleepyhead coffeegremlin moonpie toastyboi kittycat99 bigchungus wafflez nightowl
pancake_lord doomguy sweatlord cozygamer potato frogman mango deckenjoyer couchpotato lagmaster quietkid""".split()

GAMES = """Elden Ring|Baldur's Gate 3|Hades 2|Stardew Valley|Deep Rock Galactic|Helldivers 2|Valheim|Terraria|Minecraft|
Apex Legends|Counter-Strike 2|Dota 2|Rocket League|Lethal Company|Phasmophobia|Sea of Thieves|Monster Hunter|Overwatch|
Fortnite|Among Us|Vampire Survivors|Hollow Knight|Cyberpunk 2077|Palworld|Destiny 2|Team Fortress 2|Left 4 Dead 2|
Risk of Rain 2|Factorio|Satisfactory|Marvel Rivals|Fall Guys|Dead by Daylight|Warframe|Path of Exile 2|Balatro|
Animal Crossing|Mario Kart|Street Fighter 6|League of Legends|Valorant|Rust|DayZ|The Finals|Deadlock|Civilization""".replace(
    "\n", ""
).split("|")

SCENES = [
    (
        "Discord | server: {game} fans | #general",
        "gaming",
        [
            "anyone on tonight",
            "just got home, hopping on in a bit",
            "the new patch is kinda wild ngl",
            "wait they nerfed it again?",
            "lol yeah i saw that",
            "who wants to run a few games",
            "i'm down after dinner",
            "can someone send the invite link",
            "bro i've been stuck on this boss for like an hour",
            "just use the shield build it's way easier",
            "ok that actually worked lmao",
            "gg that was so close",
            "is the server down for anyone else",
            "nah it's fine for me",
            "my wifi is being dumb again",
            "brb grabbing food",
            "back",
            "what did i miss",
            "nothing much we just lost twice",
            "rip",
            "let's go one more",
            "i need to sleep soon tho",
        ],
    ),
    (
        "Discord | server: the boys | #off-topic",
        "friends",
        [
            "did anyone watch the game last night",
            "yeah that ending was insane",
            "i still can't believe he missed that",
            "what are you guys doing this weekend",
            "probably nothing honestly",
            "we should get food saturday",
            "i'm in",
            "same",
            "where tho",
            "that pizza place by the mall?",
            "sounds good to me",
            "lmao why is my cat sitting on my keyboard",
            "send pic",
            "i have work at 8 tomorrow ugh",
            "that sucks man",
            "how was the interview",
            "it went ok i think",
            "they said they'd call me next week",
            "good luck dude",
            "thanks i'm kinda nervous",
            "you'll be fine",
        ],
    ),
    (
        "Steam chat | group: {game} squad",
        "lobby",
        [
            "inv me",
            "sent",
            "joining now",
            "can you hear me",
            "your mic is muted",
            "oh wait my bad",
            "ok now?",
            "yeah got you",
            "who's hosting",
            "i can host",
            "ready when you are",
            "one sec loading",
            "my game crashed hold on",
            "np take your time",
            "back in",
            "go go go",
            "nice shot",
            "behind you",
            "thanks for the save",
            "i'm out of ammo",
            "drop me some",
            "on my way",
            "gg",
            "that was fun",
            "same time tomorrow?",
            "yeah for sure",
        ],
    ),
    (
        "In-game chat | {game} | lobby",
        "ingame",
        [
            "gl hf",
            "gg wp",
            "ez",
            "nice try",
            "mid please",
            "can i jungle",
            "go top",
            "wait for me",
            "push now",
            "don't chase",
            "why did you leave",
            "lag",
            "sorry dc",
            "report him",
            "lol",
            "nice",
            "ty",
            "np",
            "group up",
            "help me",
            "omw",
            "they're behind us",
            "one more?",
            "ff",
            "no don't give up",
            "we can still win this",
            "ok last game",
            "who's buying",
        ],
    ),
    (
        "Text messages | between two friends",
        "dm",
        [
            "hey are you up",
            "yeah what's up",
            "can you pick me up later",
            "what time",
            "like 6?",
            "ok sounds good",
            "thanks!!",
            "np",
            "did you see what she posted lol",
            "no what",
            "nvm i'll show you later",
            "omg ok",
            "are we still on for tonight",
            "yes!! can't wait",
            "running a little late sorry",
            "all good",
            "i'm here",
            "where are you",
            "inside by the door",
            "got it coming",
            "love you",
            "haha you too",
            "good night",
            "night",
        ],
    ),
    (
        "Discord | server: study group | #chat",
        "school",
        [
            "did anyone finish the homework",
            "not yet it's so long",
            "which question are you on",
            "number 4 is confusing",
            "i think you just divide by two",
            "oh that makes sense",
            "thank you so much",
            "when is the test again",
            "friday i think",
            "i'm so not ready",
            "same lol",
            "wanna call later and go over it",
            "sure what time works",
            "after 7?",
            "perfect",
            "can someone send the notes",
            "just sent them",
            "you're a lifesaver",
        ],
    ),
    (
        "Discord | server: Steam Deck owners | #help",
        "tech",
        [
            "does anyone know how to fix the stutter in this game",
            "try capping the fps at 40",
            "turn off vsync too",
            "that helped a lot thanks",
            "battery life is kind of bad tho",
            "lower the brightness and tdp",
            "what's your sd card",
            "just a cheap 512gb one",
            "works fine for me",
            "is proton experimental better",
            "depends on the game",
            "mine won't connect to wifi after the update",
            "restart it a couple times",
            "did that already",
            "weird maybe reset network settings",
            "ok i'll try that",
            "it worked!",
            "nice",
        ],
    ),
    (
        "Twitch chat | streamer playing {game}",
        "stream",
        [
            "lets gooo",
            "LUL",
            "that was so clean",
            "no way",
            "chat is he gonna make it",
            "first time here love the vibes",
            "hi from germany",
            "how long have you been streaming",
            "what's your sens",
            "play the other map next",
            "he's cooking",
            "unlucky",
            "W",
            "L",
            "so close",
            "again again",
            "my favorite streamer fr",
            "gn chat",
            "hype",
        ],
    ),
    (
        "Group chat | family",
        "family",
        [
            "dinner is at 7",
            "can someone get milk on the way home",
            "i'll grab it",
            "thanks honey",
            "what time are you coming over sunday",
            "around noon",
            "ok see you then",
            "happy birthday!!",
            "thank you everyone",
            "did grandma get home ok",
            "yes she just called",
            "good",
            "who has the spare key",
            "i think it's under the mat",
            "found it",
            "love you all",
            "drive safe",
        ],
    ),
    (
        "Discord | server: book & movie club | #general",
        "hobby",
        [
            "just finished the book",
            "no spoilers please",
            "i'm only halfway through",
            "the second part is so good",
            "wait until you get to the end",
            "omg you're right",
            "what should we read next",
            "i vote for something shorter",
            "agreed",
            "anyone seen the new movie",
            "not yet is it good",
            "it's ok honestly kind of long",
            "the music was great though",
            "i'll watch it this weekend",
            "let me know what you think",
        ],
    ),
    (
        "Discord | server: {game} trading | #lfg",
        "lfg",
        [
            "lf2m for raid",
            "need a healer",
            "i can heal",
            "add me",
            "what's your ign",
            "same as discord",
            "sent friend request",
            "accepted",
            "anyone selling materials",
            "how much do you want for it",
            "would you take 50k",
            "deal",
            "meet at the market",
            "here",
            "thanks pleasure doing business",
            "lfg ranked anyone",
            "what rank are you",
            "gold",
            "close enough lol",
            "join vc",
        ],
    ),
    (
        "DM | discord",
        "dm2",
        [
            "yo",
            "sup",
            "you wanna play later",
            "maybe in like an hour",
            "bet",
            "did you get the game yet",
            "not yet it's on sale tomorrow",
            "oh nice",
            "how's your week been",
            "busy but fine",
            "same tbh",
            "lol",
            "i'm so tired",
            "go to sleep then",
            "can't i have stuff to do",
            "rip",
            "talk later?",
            "yeah ttyl",
        ],
    ),
]

TOPICS = """the new update|a funny clip|work tomorrow|weekend plans|a boss fight|ranked games|food|a new game release|
a sale on Steam|someone's birthday|a movie|music|school|the weather|a broken controller|their pets|a trip|being tired|
a tournament|building a pc|a bug in the game|cosplay|a concert|a job interview|moving apartments|a group project|
memes|a new phone|someone being late|coffee|a road trip|a sports game|a cooking fail|their cat|a speedrun|achievements""".replace(
    "\n", ""
).split("|")


def make_prompt(rng):
    head, kind, pool = rng.choice(SCENES)
    game = rng.choice(GAMES)
    names = rng.sample(NAMES, rng.randint(2, 6) if kind not in ("dm", "dm2") else 2)
    lines = [f"=== {head.format(game=game)} ===", f"(chat log, topic: {rng.choice(TOPICS)})"]
    for s in rng.sample(pool, rng.randint(4, 7)):
        lines.append(f"{rng.choice(names)}: {s}")
    return "\n".join(lines) + "\n" + rng.choice(names) + ":"


def main():
    rng = random.Random(SEED * 1000003 + int(time.time()))
    tok = AutoTokenizer.from_pretrained(MODEL)
    tok.padding_side = "left"
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=torch.bfloat16, device_map="cuda:0")
    model.eval()
    t0 = time.time()
    done = 0
    with open(OUT, "a", encoding="utf-8") as f:
        while time.time() - t0 < MINUTES * 60:
            prompts = [make_prompt(rng) for _ in range(BATCH)]
            enc = tok(prompts, return_tensors="pt", padding=True).to("cuda:0")
            tb = time.time()
            with torch.no_grad():
                out = model.generate(**enc, max_new_tokens=NEW, do_sample=True, temperature=1.0, top_p=0.95, pad_token_id=tok.pad_token_id)
            gen = tok.batch_decode(out[:, enc["input_ids"].shape[1] :], skip_special_tokens=True)
            ntok = int((out[:, enc["input_ids"].shape[1] :] != tok.pad_token_id).sum())
            for p, g in zip(prompts, gen, strict=True):
                f.write(json.dumps({"p": p.split("\n", 1)[0], "last": p.rsplit("\n", 1)[1], "g": g}) + "\n")
            f.flush()
            done += BATCH
            print(
                f"{time.time() - t0:.0f}s batch {time.time() - tb:.1f}s {ntok} tok {ntok / (time.time() - tb):.0f} tok/s total {done}",
                flush=True,
            )


if __name__ == "__main__":
    main()
