#!/usr/bin/env python3
"""Zpracovaná nahrávka schůzky → šifrovaně do schránky Pipeline (stejná schránka a šifra jako vstupní dotazník).

Použití:  python3 nahravka.py rec.json
  rec.json = {"id": "<Fireflies ID>", "at": "ISO", "client": "Jméno Příjmení", "phone": "", "email": "",
              "notes": ["…"], "tasks": [{"text": "…", "due": "YYYY-MM-DD"}], "summary": ["…"],
              "fp": {"klient.zam": 45000, …,
                     "majetek": [{"nazev", "typ", "hodnota", "vklad"}], "nefin": [{"nazev", "typ", "hodnota", "najem"}],
                     "uvery": [{"typ", "nazev", "zustatek", "splatka", "fixace_do", "splatnost"}],
                     "cile": [{"nazev", "castka", "za_let"}], "deti": [{"jmeno", "narozen", "vs"}]},
              "next": {"step": "…", "date": "YYYY-MM-DD"},
              "birth": "YYYY-MM-DD",                                   # do karty klienta, jen když tam chybí
              "meeting": {"start": "YYYY-MM-DDTHH:MM", "online": false}}  # domluvená schůzka – Pipeline ji po schválení
                                                                          # zapíše do kalendáře (při kolizi založí úkol)
Pipeline nahrávku nejdřív jen ukáže ke schválení (Přijmout / Odmítnout) – zapíše ji až po přijetí.

Šifra (pipeline/dzcrypto.js): ECDH P-256 s veřejným klíčem poradce → HKDF-SHA-256 (sůl 16 B, info „zfp-dotaznik-v1“)
→ AES-256-GCM, první bajt otevřeného textu 1 = gzip. Přečíst to jde jen soukromým klíčem, který je jen v Pipeline poradce.
Po zápisu do schránky pošle prostředník obecnou push notifikaci (bez jména a dat klienta).
"""
import base64, gzip, json, os, sys, urllib.request
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

TO = "kudlicka.vojtech2002@gmail.com"
PUB = "BLuX42kajBu-1zXVvdCDa89b2HToLwbBocLU7UY4cbvINbAiDzDXfmkCOG_GzuvH0tU98sQl72Z1rGj5jS7LSHI"
FS = "https://firestore.googleapis.com/v1/projects/zfp-pipeline/databases/(default)/documents/dzinbox?key=AIzaSyDfS0FJx1EtbgqJSUUOK722PB_5Zo6hCuI"
PUSH = "https://zfp-push.kudlicka-vojtech2002.workers.dev/ping"
ORIGIN = "https://zfpconsulting.github.io"
CHUNK = 900000
UA = "zfp-nahravka/1.1 (+https://zfpconsulting.github.io/pipeline/)"  # Cloudflare odmítá výchozí „Python-urllib“ (403)


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def seal(pub_b64: str, obj: dict) -> dict:
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64u(pub_b64))
    eph = ec.generate_private_key(ec.SECP256R1())
    shared = eph.exchange(ec.ECDH(), pub)
    salt, iv = os.urandom(16), os.urandom(12)
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=b"zfp-dotaznik-v1").derive(shared)
    body = gzip.compress(json.dumps(obj, ensure_ascii=False).encode())
    ct = AESGCM(key).encrypt(iv, b"\x01" + body, None)
    epk = eph.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return {"epk": b64u(epk), "salt": b64u(salt), "iv": b64u(iv), "ct": b64u(ct)}


def post(box: dict) -> int:
    parts = [box["ct"][i:i + CHUNK] for i in range(0, len(box["ct"]), CHUNK)] or [""]
    g = b64u(os.urandom(15))
    for i, part in enumerate(parts):
        fields = {"to": {"stringValue": TO}, "v": {"integerValue": "1"}, "g": {"stringValue": g},
                  "i": {"integerValue": str(i)}, "n": {"integerValue": "999"},
                  "nn": {"integerValue": str(len(parts))},  # n=999: starší verze Pipeline čeká na zbytek a nahrávku nezapíše bez schválení
                  "epk": {"stringValue": box["epk"]}, "salt": {"stringValue": box["salt"]},
                  "iv": {"stringValue": box["iv"]}, "ct": {"stringValue": part}}
        req = urllib.request.Request(FS, data=json.dumps({"fields": fields}).encode(),
                                     headers={"Content-Type": "application/json", "User-Agent": UA}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            if r.status >= 300:
                raise RuntimeError("schránka odmítla zápis: %s" % r.status)
    return len(parts)


def ping() -> None:
    req = urllib.request.Request(PUSH, data=json.dumps({"to": TO, "k": "nr"}).encode(),
                                 headers={"Content-Type": "application/json", "Origin": ORIGIN, "User-Agent": UA}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:  # notifikace je jen bonus – zápis do schránky už proběhl
        print("push se nepovedl:", e, file=sys.stderr)


if __name__ == "__main__":
    rec = json.load(open(sys.argv[1], encoding="utf-8"))
    if not str(rec.get("client", "")).strip():
        sys.exit("chybí jméno klienta")
    obj = {"type": "fp-nahravka", "v": 1, "at": rec.get("at"), "rec": rec}
    if "--dry" in sys.argv:
        print(json.dumps(seal(PUB, obj)))
        sys.exit(0)
    n = post(seal(PUB, obj))
    ping()
    print("ok – zapsáno do schránky (%d část)" % n)
