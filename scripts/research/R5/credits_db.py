"""Credit / licence lookup for every source file the R5 pipeline can use."""
import json, os, re

ROOT = "/home/user/special-telegram"
DL = os.path.join(ROOT, "scripts/_cache/audio_dl")
_mk = None

MIXKIT_LIC = "Mixkit Sound Effects Free License (https://mixkit.co/license/#sfxFree)"
CC0 = "CC0 1.0"

KENNEY = {
    "kenney_casino-audio": ("Casino Audio", "https://kenney.nl/assets/casino-audio"),
    "kenney_impact-sounds": ("Impact Sounds", "https://kenney.nl/assets/impact-sounds"),
    "kenney_interface-sounds": ("Interface Sounds", "https://kenney.nl/assets/interface-sounds"),
    "kenney_music-jingles": ("Music Jingles", "https://kenney.nl/assets/music-jingles"),
    "kenney_rpg-audio": ("RPG Audio", "https://kenney.nl/assets/rpg-audio"),
    "kenney_ui-audio": ("UI Audio", "https://kenney.nl/assets/ui-audio"),
    "kenney_digital-audio": ("Digital Audio", "https://kenney.nl/assets/digital-audio"),
}

# OpenGameArt packs: dir -> (page url, author, licence, note)
OGA = {
    "female_screams": ("https://opengameart.org/content/female-screams", "congusbongus (compiled; recordings by tcrocker68 / pushkin / Archeos on freesound)", "CC0 1.0 (files 1-4 per included license.txt)"),
    "girly_scream": ("https://opengameart.org/content/girly-scream", "Ferk (performed by Mariel Carmona Varo)", "CC0 1.0 (multi-licensed: CC0 / CC-BY 3.0 / CC-BY-SA 3.0 / GPL)"),
    "burps": ("https://opengameart.org/content/burps", "Wandering Door Games", "CC-BY-SA 4.0"),
    "hits": ("https://opengameart.org/content/punch-slap-n-kick", "congusbongus, adapted from CGEffex (freesound #98341)", "CC-BY 3.0"),
    "thwack": ("https://opengameart.org/content/thwack-sounds", "Jordan Irwin (AntumDeluge)", CC0),
    "cat": ("https://opengameart.org/content/cat-purr-meow", "Kerzoven", CC0),
    "salt": ("https://opengameart.org/content/adding-salt", "TinyWorlds", CC0),
    "boil": ("https://opengameart.org/content/boiling-water-loops", "TinyWorlds", CC0),
    "giggle": ("https://opengameart.org/content/group-giggling", "Nocturnal_Vanguard (AuraVoice) / AntumDeluge", CC0),
    "ghostbreath": ("https://opengameart.org/content/ghost-breath", "qubodup", CC0),
    "ghostloops": ("https://opengameart.org/content/4-atmospheric-ghostly-loops", "qubodup", CC0),
    "dog7z": ("https://opengameart.org/content/dog-sounds", "pauliuw", CC0),
    "dogbark": ("https://opengameart.org/content/dog-barking-mono", "HaelDB", CC0),
    "kitten": ("https://opengameart.org/content/kitten-mew", "AntumDeluge / IgnasD", CC0),
    "cicada": ("https://opengameart.org/content/cicada-sounds", "syncopika", CC0),
    "household": ("https://opengameart.org/content/general-household-sound-effects", "bretbernhoft", CC0),
    "stove": ("https://opengameart.org/content/stove-switch", "TinyWorlds", CC0),
    "kitchen_davidw": ("https://opengameart.org/content/kitchen-ambience-sfx", "DavidW", "CC-BY 4.0"),
    "engines_dklon": ("https://opengameart.org/content/engines-startup-idle-rev", "dklon", "CC-BY-SA 3.0"),
    "cc0_100": ("https://opengameart.org/content/100-cc0-sfx", "rubberduck", CC0),
    "gong_dklon": ("https://opengameart.org/content/gonk-gong", "dklon", "CC-BY 3.0"),
}
OGA_FILE_OVERRIDE = {
    "ghostly_cackle_laugh_1.ogg": ("https://opengameart.org/content/ghostly-cackle-laugh-1", "Nocturnal_Vanguard (AuraVoice)", CC0),
    "group_giggling.ogg": ("https://opengameart.org/content/group-giggling", "Nocturnal_Vanguard (AuraVoice)", CC0),
    "witch_cackle-1_0.ogg": ("https://opengameart.org/content/witch-cackle", "Jordan Irwin (AntumDeluge)", CC0),
    "kitten_mew-1.wav": ("https://opengameart.org/content/kitten-mew", "Jordan Irwin (AntumDeluge)", CC0),
    "Meow.ogg": ("https://opengameart.org/content/meow", "IgnasD", CC0),
}

# Wikimedia Commons metadata (licence/author) fetched via the API (see NOTES.md)
COMMONS = {
    "Mating_call_of_a_male_Tokay_gecko_(Gekko_gecko).ogg": ("File:Mating call of a male Tokay gecko (Gekko gecko).ogg", "Richard Ling", "Public domain"),
    "Gekko_gecko.wav": ("File:Gekko gecko.wav", "Israel Benjumeda", "CC BY-SA 3.0"),
    "2013-07-24_00-19-04hrs_Chiang_Mai_Chang_Khien_rain_animal_sounds_night_time.ogg": ("File:2013-07-24 00-19-04hrs Chiang Mai Chang Khien rain animal sounds night time.ogg", "Takeaway", "CC BY-SA 3.0"),
    "Sound_of_a_unidentified_bird_in_Bangkok_Thailand.ogg": ("File:Sound of a unidentified bird in Bangkok, Thailand.ogg", "Amada44", "CC BY-SA 3.0"),
    "Th-Thai_tones_marked_with_IPA_with_na.ogg": ("File:Th-Thai tones marked with IPA with na.ogg", "Alifshinobi", "CC BY-SA 3.0"),
    "ราดหน้าเต้าหู้เจ.wav": ("File:ราดหน้าเต้าหู้เจ.wav", "IJAN koon", "CC BY-SA 3.0"),
    "Th-jop.ogg": ("File:Th-jop.ogg", "Nakaret", "Public domain"),
}
for _n in ["khaao", "gai", "padthai", "tom_yum", "tuktuk", "cha"]:
    COMMONS[f"Th-{_n}.ogg"] = (f"File:Th-{_n.replace('_', ' ')}.ogg", "Alifshinobi", "CC BY-SA 3.0")
for _n in ["sa0nuk2", "thaa1", "thaa3", "thaa4", "maw3", "maw5", "kaw1", "kaw2", "kaw3", "muea1", "muea3", "muea4",
           "ruu1", "ruu4", "ruu5", "phaw1", "phaw3", "yang1", "yang4", "dai1", "chang1", "chang3", "aan1", "rian1",
           "rian5", "faa4", "tai1", "taai3", "nuea4", "lue4"]:
    COMMONS[f"Th-{_n}.ogg"] = (f"File:Th-{_n}.ogg", "Alifshinobi", "CC BY-SA 4.0 (verify per file)")

PEACE = ("https://archive.org/details/peace-corps-thai", "U.S. Peace Corps / Thailand (Basic Introduction to Thai Language, 2005)",
         "Public domain (work of the U.S. Government, 17 U.S.C. §105)")


def mixkit_catalog():
    global _mk
    if _mk is None:
        _mk = json.load(open(os.path.join(DL, "mixkit/catalog.json")))
    return _mk


def credit(path):
    """-> dict(source, url, author, licence)"""
    p = os.path.abspath(path)
    b = os.path.basename(p)
    if "/mixkit/wav/" in p:
        i = re.match(r"(\d+)", b).group(1)
        t = mixkit_catalog().get(i, {}).get("title", "?")
        return dict(source=f'Mixkit #{i} "{t}"', url=f"https://assets.mixkit.co/active_storage/sfx/{i}/{i}.wav",
                    author="Mixkit (Envato)", licence=MIXKIT_LIC)
    for d, (name, url) in KENNEY.items():
        if f"/kenney/{d}/" in p:
            return dict(source=f"Kenney {name}: {b}", url=url, author="Kenney Vleugels (kenney.nl)", licence=CC0)
    if "/oga/" in p:
        pack = p.split("/oga/")[1].split("/")[0]
        if b in OGA_FILE_OVERRIDE:
            url, au, lic = OGA_FILE_OVERRIDE[b]
        else:
            url, au, lic = OGA[pack]
        return dict(source=f"OpenGameArt: {b}", url=url, author=au, licence=lic)
    if "/commons_" in p:
        key = b
        if key in COMMONS:
            t, au, lic = COMMONS[key]
        elif b.startswith("LL-Q9217"):
            t = "File:" + b.replace("_", " ")
            spk = b.split("-")[2] if b.count("-") >= 3 else "Lingua Libre speaker"
            au, lic = f"{spk} (Lingua Libre)", "CC BY-SA 4.0"
        else:
            t, au, lic = "File:" + b, "see Commons page", "see Commons page"
        return dict(source=f"Wikimedia Commons {t}", url="https://commons.wikimedia.org/wiki/" + t.replace(" ", "_"),
                    author=au, licence=lic)
    if "/archive_peacecorps_thai/" in p:
        url, au, lic = PEACE
        return dict(source=f"Peace Corps Thai lessons: {b}", url=url, author=au, licence=lic)
    if "/incompetech/" in p:
        title = os.path.splitext(b)[0].replace("_", " ")
        return dict(source=f'"{title}" (incompetech.com)', url="https://incompetech.com/music/royalty-free/",
                    author="Kevin MacLeod", licence="CC BY 4.0")
    if "/synth/" in p or "/design/" in p:
        return dict(source="Original synthesis/sound design (R5-audio, numpy/scipy)", url="(this repository)",
                    author="Hia Phat project (R5-audio)", licence="CC0 1.0 (project original)")
    if "/espeak/" in p:
        return dict(source="Synthesized speech, espeak-ng Thai voice (generated output)", url="https://github.com/espeak-ng/espeak-ng",
                    author="Hia Phat project (R5-audio) via espeak-ng", licence="Generated audio (not covered by espeak-ng GPL); project original")
    return dict(source=b, url="?", author="?", licence="?")
