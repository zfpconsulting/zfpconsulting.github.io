#!/usr/bin/env python3
"""Formuláře institucí pro záložku Formuláře v Pipeline.

Stáhne veřejně dostupné formuláře (změny, výpovědi, převody) podle tools/formulare-zdroje.json do pipeline/formulare/<instituce>/,
bezztrátově je zmenší (qpdf) a heuristicky namapuje vyplnitelná pole (AcroForm) na údaje klienta – podle názvu pole, jeho popisku
(/TU) a textu, který je v PDF u pole (vlevo / nad / v rámečku). Výsledek: pipeline/formulare/index.json, který čte formulare.js.

  python3 tools/formulare.py            stáhne vše znovu a přegeneruje index.json
  python3 tools/formulare.py --offline  jen přemapuje už stažené soubory (bez sítě)
  python3 tools/formulare.py --only zfpi,conseq  stáhne jen formuláře těchto institucí (a chybějící), přemapuje vše

Ruční opravy mapování: OVERRIDES níže ({"<instituce>/<soubor bez přípony>": {"název pole": "klíč" | None}}).
Klíče: cnum newcnum surname firstname fullname fullnameRev title rc birth rcbirth street streetcp cp city psc addr phone email
       account accpre bank vs ss date place placedate country („Brno, 21. 11. 2026“ do jednoho pole).
       Části hodnoty: „cnum@3“ = 4. znak čísla smlouvy (políčka po jednom znaku), „cnum@3/8“ = 4. znak z posledních 8 znaků,
       „date@d“ / „date@m“ / „date@y“ = den / měsíc / rok.
       Poradce (volba v záložce, údaje v šifrovaném bloku appky): advfirm advseat advico (obchodní zástupce – firma, sídlo, IČO),
       advname advicop advcode advphone advemail (poradce – jméno, IČO, osobní kód, telefon, e-mail).
Potřebuje: pdftotext (poppler-utils), qpdf, python3-pypdf."""
# Heuristické mapování polí AcroForm → klíče údajů klienta (jméno, RČ, adresa, číslo smlouvy …)
import pypdf, subprocess, re, sys, json, unicodedata, html
def norm(s):
    s=unicodedata.normalize('NFKD',str(s or '')); s=''.join(c for c in s if not unicodedata.combining(c))
    s=s.lower().replace('_',' ').replace('-',' ')
    return re.sub(r'\s+',' ',s).strip()
def words(pdf):
    out=subprocess.run(['pdftotext','-bbox',pdf,'-'],capture_output=True,text=True).stdout
    pages=[];cur=None
    for m in re.finditer(r'<page width="([\d.]+)" height="([\d.]+)">|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>',out):
        if m.group(1): cur={'h':float(m.group(2)),'w':[]};pages.append(cur)
        else: cur['w'].append((float(m.group(3)),float(m.group(4)),float(m.group(5)),float(m.group(6)),html.unescape(m.group(7))))
    return pages
GENERIC=re.compile(r'^(textove pole|text|fill|undefined|comb|pole|textfield|field|untitled|zaskrtavaci pole|check box|group)(?:\d|\b|_)|^[a-z]{1,2}\.?\d+[a-z]?(\.\d+)*$|^\d+$|^[a-z]\d*$')
EXCL=re.compile(r'^pz|^pzp|rodne prijmeni|titul za jmenem|zprostred|poradc|ziskatel|zastupc|opravnen|urcen|dedic|zakonn|zamestnavatel|obmysl|pojisteny 2|2\. pojist|dite|ditet|spolecnost|\bico\b|zrostred|osobni cislo|reg(istracni)? ?zn|vozid|barcode|hvezda|pruk|vydal|platn|statni|obcanstv|narozeni misto|misto narozeni|mistnar|pohlavi|zeme|stat\b|koresp|predvolba|nazev firmy|nov[eayo] (prijmeni|jmeno|adres|ulice|titul|telefon|e ?mail|bydl)|^nov[eayo]\\b')
def classify(h):
    if re.search(r'nov[aeyou]* (pojistn[aeé] )?smlouv|nove smlouv|nova smlouva|cislo nove|^smlouvu c|pojistnou smlouvu c|smlouvu u .{0,40}cisl|prevod.{0,30}smlouv',h): return 'newcnum'
    if re.search(r'rodne ?cislo.{0,6}datum|rodne ?cislo ?/? ?ico|rodne cisloico',h): return 'rcbirth'
    if re.search(r'^obec|\bobec\b',h) and not re.search(r'narozeni|koresp|kontakt|zastupc|zprostred',h): return 'city'
    if re.search(r'(^|\b)(zeme|stat)\b',h) and not re.search(r'narozeni|obcanstv|koresp|kontakt|zastupc|zprostred|statni|ucet|bank|vydal|platn|pojisteny 2|2\. pojist|dite|ditet|zakonn|opravnen|dedic|obmysl',h): return 'country'
    if EXCL.search(h): return None
    if re.search(r'nov[aeéyou]* (pojistn[aeé] )?smlouv|nove smlouv|nova smlouva|cislo nove|^smlouvu c|pojistnou smlouvu c|smlouvu u .{0,40}cisl|prevod.{0,30}smlouv',h): return 'newcnum'
    if re.search(r'predcisli a cislo|predcisli.{0,3}cislo uctu',h): return 'account'
    if re.search(r'predcisli',h): return 'accpre'
    if re.search(r'(cislo|c\.) ?(pojistne |penzijni |teto )?(smlouv|sml\b)|cislosml|cislo smlouvy|smlouva cislo|smlouvy cislo|pojistna smlouva c|^ps cislo 1$|^cp\d?$|cislo pojistne smlouvy|cislosmlouvy',h): return 'cnum'
    if re.search(r'prijmeni.{0,6}jmeno|jmeno.{0,4}(a )?prijmeni|titul, jmeno|jmeno prijmeni',h): return 'fullname' if h.find('jmeno')<h.find('prijmeni') else 'fullnameRev'
    if re.search(r'prijmeni|p.ijmeni|pcijmeni|pbijmeni',h): return 'surname'
    if re.search(r'^jmeno|\bjmeno\d?$|^cjmeno|^jmeno\d',h): return 'firstname'
    if re.search(r'^c?titul',h): return 'title'
    if re.search(r'rodne cislo|^r ?c\d?$|\brc\b|^crc$|rodne\b',h) and 'datum' not in h: return 'rc'
    if re.search(r'rodne cislo.{0,6}datum',h): return 'rcbirth'
    if re.search(r'datum narozeni|^datnar|^narozeni$|narozeni\d?$',h): return 'birth'
    if re.search(r'^ulice|\bulice\b',h) and re.search(r'cislo|c\.? ?p|popisn',h): return 'streetcp'
    if re.search(r'^ulice|\bulice\b',h): return 'street'
    if re.search(r'^c\.? ?p\.?$|cislo popisne|^c\.?p\.?\b|c\. ?p\./|c\.p\./',h): return 'cp'
    if re.search(r'^psc|\bpsc\b',h): return 'psc'
    if re.search(r'^obec|\bobec\b|^mesto|\bmesto\b',h) and 'narozeni' not in h: return 'city'
    if re.search(r'adresa|trvaly pobyt|trvale bydl|bydliste',h) and not re.search(r'e ?mail|kontaktni|koresp',h): return 'addr'
    if re.search(r'^e ?mail|\be ?mail\b',h) and 'telefon' not in h: return 'email'
    if re.search(r'telefon|mobil|^tel\b',h): return 'phone'
    if re.search(r'kod banky',h): return 'bank'
    if re.search(r'cislo (bankovniho )?uctu|^cislouctu$|^ucet|bankovni ucet|\bucet\b',h): return 'account'
    if re.search(r'variabilni|variab symbol|^vs\b|\bvs\b',h): return 'vs'
    if re.search(r'specificky|^ss\b|\bss\b',h): return 'ss'
    if re.search(r'^dne\b|^datum$|datum podpisu|^dne$|datum2$',h): return 'date'
    if re.search(r'^v$|^v dne|misto podpisu|^misto$',h): return 'place'
    return None
def label_for(ws,x0,y0,x1,y1):
    cy=(y0+y1)/2
    left=[w for w in ws if w[2]<=x0+3 and x0-w[2]<170 and w[1]-2<=cy<=w[3]+2]
    left.sort(key=lambda w:w[0])
    run=[];prev=x0
    for w in reversed(left):
        if prev-w[2]>(40 if not run else 12): break
        run.insert(0,w);prev=w[0]
    ab=[w for w in ws if -1<=y0-w[3]<=15 and w[0]>=x0-8 and w[0]<x0+max(40,min(x1-x0,200))]
    if ab:
        top=max(w[1] for w in ab); ab=[w for w in ab if abs(w[1]-top)<3]
    ab.sort(key=lambda w:w[0])
    inside=[w for w in ws if w[0]>=x0-1 and w[2]<=x1+1 and w[1]>=y0-1 and w[3]<=y1+1]
    below=[w for w in ws if 0<=w[1]-y1<=9 and w[0]>=x0-6 and w[0]<x0+60]
    below.sort(key=lambda w:w[0])
    return ' '.join(w[4] for w in run),' '.join(w[4] for w in ab),' '.join(w[4] for w in inside),' '.join(w[4] for w in below)
import os
OVR={}
def analyse(pdf,ovkey=''):
    r=pypdf.PdfReader(pdf); P=words(pdf); res=[]
    for pi,p in enumerate(r.pages):
        if pi>=len(P): break
        H=P[pi]['h']; ws=P[pi]['w']
        mb=[float(v) for v in p.mediabox]
        for a in (p.get('/Annots') or []):
            a=a.get_object()
            if a.get('/Subtype')!='/Widget': continue
            nm=[];o=a;ft=None;tu=None;ff=0
            while o is not None:
                if o.get('/T') is not None: nm.insert(0,str(o.get('/T')))
                if ft is None and o.get('/FT'): ft=str(o.get('/FT'))
                if tu is None and o.get('/TU'): tu=str(o.get('/TU'))
                if o.get('/Ff') and not ff: ff=int(o.get('/Ff'))
                o=o.get('/Parent').get_object() if o.get('/Parent') else None
            if ft!='/Tx': continue
            rc=[float(v) for v in a.get('/Rect')]; x0,x1=min(rc[0],rc[2])-mb[0],max(rc[0],rc[2])-mb[0]
            yb,yt=min(rc[1],rc[3])-mb[1],max(rc[1],rc[3])-mb[1]
            y0,y1=H-yt,H-yb
            name='.'.join(nm)
            left,above,inside,below=label_for(ws,x0,y0,x1,y1)
            hn=norm(name.split('.')[-1] if re.match(r'^(textove pole|fill|text|undefined)',norm(name)) else name)
            tun=norm(tu) if tu and tu not in('None','undefined') else ''
            key=None;src=''
            generic=(not hn) or bool(GENERIC.match(hn))
            if not generic:
                key=classify(hn);src='name'
                if not key and not EXCL.search(hn) and tun and not GENERIC.match(tun): key=classify(tun);src='tu'
            else:
                if tun and not GENERIC.match(tun) and not EXCL.search(tun):
                    key=classify(tun);src='tu'
                if not key and not (tun and EXCL.search(tun)):
                    for cand,s2 in ((norm(inside),'in'),(norm(above)[:70],'above'),(norm(left)[-60:],'left')):
                        if not cand: continue
                        k=classify(cand)
                        if k: key=k;src=s2;break
                        if s2 in ('in','left') and EXCL.search(cand): break
            res.append(dict(page=pi,y=round(y0),x=round(x0),w=round(x1-x0),name=name,tu=tun,lab=(left or above or inside or below)[:50],key=key,src=src,maxlen=a.get('/MaxLen'),comb=bool(ff&(1<<24))))
    res.sort(key=lambda d:(d['page'],d['y'],d['x']))
    ov=OVR.get(ovkey,{})
    for d in res:
        if d['name'] in ov: d['key']=ov[d['name']] or None; d['src']='ovr'
    PERSON={'surname','firstname','fullname','fullnameRev','title','rc','birth','street','streetcp','cp','city','psc','addr','phone','email'}
    first=next((d for d in res if d['key'] in PERSON),None)
    keys={d['key'] for d in res if d['key']}
    used=set();fill={}
    split={'firstname','surname'}<=keys
    for d in res:
        k=d['key']
        if not k: continue
        if split and k in('fullname','fullnameRev') and d['src']!='ovr': continue
        if k in PERSON and first and d['src']!='ovr':
            if d['page']!=first['page'] or d['y']<first['y']-25 or d['y']>first['y']+190: continue
        if k=='addr' and ({'street','streetcp'}&keys) and d['src']!='ovr': continue
        if k=='addr' and ({'city','psc'}&keys) and d['src']!='ovr': k='streetcp'
        uk=(k,d['page']) if k=='cnum' else k
        if uk in used or d['name'] in fill: continue
        fill[d['name']]=k; used.add(uk); d['use']=True
    return res,fill

OVERRIDES={
 "allianz/pokyn-pro-vyplatu-odkupneho-odbytneho":{"Textové pole5":None,"Textové pole40":"fullname","Textové pole42":"email","Textové pole52":None,"Textové pole53":None,"Textové pole50":None,"Textové pole51":None},
 "koop/zadost-o-ukonceni-pojistne-smlouvy":{"B3":None,"B.0":"rc","B.1":"fullname","B4":"streetcp","PSC B":"psc","B5":"city","D1":"accpre","D2":"account","D3":"bank","D4":"newcnum","F1":None,"F3":None},
 "koop/oznameni-o-odstoupeni-od-pojistne-smlouvy":{"B.0":"rc","B.1":"fullname","B4":"streetcp","PSC B":"psc","B5":"city"},
 "koop/zadost-o-zmenu-administrativni":{"B.0":"rc","B.1":"fullname","B4":"streetcp","PSC B":"psc","B5":"city"},
 "koop/zadost-o-zavedeni-ci-zmenu-prispevku-zamestnavatele":{"CP HIP":None,"B13":None,"C10":None},
 "genps/zadost-o-ukonceni-smlouvy-a-prevod-prostredku-do-generali-ps":{"Titul":"firstname","undefined_2":"title","comb_6":"street","comb_7":"cp","comb_5":None,"comb_12":None,"Místo":"city","Místo_2":None,"undefined_6":None},
 "nnps/vypoved-a-zadost-o-prevod-prostredku-do-nn-ps":{"Text3":"cnum","Text4":"newcnum","Text5":"surname","Text6":"firstname","Text7":"title","Text8":"rc","Text9":"birth","Text10":"streetcp","Text11":"psc","Text12":"city","Text14":None,"Text15":None,"Text16":None,"Text18":"place","Text19":"date"},
 "nnps/vypoved-pp-a-zadost-o-prevod-prostredku-do-penzijni-spolecno":{"Text3":"cnum","Text4":"newcnum","Text5":"surname","Text6":"firstname","Text7":"title","Text8":"rc","Text9":"birth","Text10":"streetcp","Text11":"psc","Text12":"city","Text14":None,"Text15":None,"Text16":None,"Text18":"place","Text19":"date"},
 "kbps/zadost-o-davku-transformovany-fond":{"fill_22":None},
 "allianzps/preruseni-odklad-placeni-prispevku":{"Textové pole6":None,"Textové pole7":None,"Textové pole10":None,"Textové pole4":"fullname"},
 "allianzps/stanoveni-opravnenych-nebo-urcenych-osob":{"Text3":None},
 "kbps/prevod-smlouvy-tf-dps-z-jine-penzijni-spolecnosti-do-kb-ps":{"fill_6":"rc","undefined":"cnum","Text1":"addr"},
 "csob/oznameni-o-zmene-zivotni-pojisteni":{"PS_cislo_1":"cnum"},
 "uniqa/vypoved-zanik-zp":{"undefined_2":"newcnum","cislouctu":"account","pozad variab symbol":"vs","zrostredkovatel jmeno prijmeni":"advname","zrostredkovatel mobil":"advphone","email zprostredkovatel":"advemail"},
 # Conseq penzijní společnost
 "conseqps/vypoved-dps-odbytne":{"Text1_DPS_VYP":"cnum","Text8_DPS_VYP":"rc","Text15_DPS_VYP":None,"Text16_DPS_VYP":None,"Text17_DPS_VYP":"addr","Text18_DPS_VYP":"street","Text25_DPS_VYP":"phone"},
 "conseqps/vypoved-pp-odbytne":{**{"Text%d_PP_TF"%(i+1):"cnum@%d/8"%i for i in range(8)},"Text14_PP_TF":"rc","Text22_PP_TF":None,"Text24_PP_TF":None,"Text26_PP_TF":"addr","Text27_PP_TF":"street","Text34_PP_TF":"phone"},
 "conseqps/vypoved-a-prevod-do-dps-conseq":{"Adresa účastník":"addr","Číslo smlouvy u stávající společnosti":"cnum"},
 "conseqps/vypoved-pp-a-prevod-do-pp-conseq":{"Text1":"title","Text3":"surname","Text7":"rc","Text32":"newcnum","Text27":None,"Text28":None,"Text29":None},
 "conseqps/prevod-tf-do-dps-v-ramci-conseq":{"Text27":"cnum","Text3":"fullname","Text4":"rc","Text7":"addr","Text11":None},
 "conseqps/oznameni-o-zmene-udaju":{"ucastnik_cislo":"rc","paticka_v":"place","paticka_datum":"date",
   "obchodni_zastupce":"advfirm","investicni_konzultant":"advname","osobni_kod":"advcode","zastupce_telefon":"advphone","zastupce_email":"advemail"},
 "conseqps/vyplata-castecneho-odbytneho-dps":{"V":"place","nazev_adresa_banky":None},
 "conseqps/vyplata-jednorazoveho-vyrovnani-dps":{"Text32":"cnum","Text7":"rc"},
 "conseqps/vyplata-predduchodu-dps":{"Text0":"cnum","V":"place"},
 "conseqps/vyplata-penze-dps":{"Text0":"cnum","V":"place"},
 "conseqps/vyplata-jednorazoveho-vyrovnani-pp":{**{"Text%d_PP_TF"%(i+1):"cnum@%d/8"%i for i in range(8)},"Text30":"place","Text31":"date"},
 "conseqps/vyplata-dozivotni-penze-pp":{**{"Text%d"%(101+i):"cnum@%d/8"%i for i in range(8)},"Text7":"rc","Text30":"place","Text31":"date"},
 # Conseq Investment Management
 "conseq/zadost-o-zmenu-zrizeni-trvaleho-pokynu-k-nakupu":{"Příjmení_MTPN":"fullname","rodne_cislo_ICO_MTPN":"rc","Telefon_e-mail_MTPN":None,"Ulice_smluvni_strana_MTPN":"streetcp","Místo_MTPN":"place","Datum_MTPN":"date",
   "Obchodi_zastupce_MTPN":"advfirm","Investiční_konsultant_OZ_MTPN":"advname","Ičo_OZ_MTPN":"advicop","Osobní_kod_OZ_MTPN":"advcode","Telefon_OZ_MTPN":"advphone","Email_OZ_MTPN":"advemail"},
 "conseq/pokyn-avizo":{"Ulice_smluvni_strana_PA":"streetcp","bankovni_spojeni_pro_odeslani_vytezku_PA":"account","misto_PA":"place","datum_prohlaseni_klienta_PA":"date",
   "obchodni_zastupce_PA":"advfirm","investicni_konzultant_PA":"advname","ICO_(inv_kon)_PA":"advicop","osobni_kod_PA":"advcode","telefon_obchodniho_zastupce_PA":"advphone","e-mail_obchodniho_zastupce_PA":"advemail"},
 "conseq/oznameni-o-zmene-udaju":{"Text_OZ-2404_1":"fullname","Text_OZ-2404_2":"rc","Text_OZ-2404_3":"streetcp","Text_OZ-2404_4":"city","Text_OZ-2404_5":"psc",**{"Text_OZ-2404_%d"%i:None for i in range(6,60)},
   "Text_OZ-2404_47":"advfirm","Text_OZ-2404_48":"advseat","Text_OZ-2404_49":"advico","Text_OZ-2404_50":"advname","Text_OZ-2404_51":"advicop","Text_OZ-2404_52":"advcode","Text_OZ-2404_54":"advphone","Text_OZ-2404_55":"advemail"},
 "conseq/oznameni-o-zmene-obchodniho-zastupce":{"OZOZ_2404_1":"fullname","OZOZ_2404_2":"rc","OZOZ_2404_3":"streetcp","OZOZ_2404_4":"city","OZOZ_2404_5":"psc","OZOZ_2404_7":"cnum","OZOZ_2404_54":"place",
   "OZOZ_2404_32":"advfirm","OZOZ_2404_56":"advseat","OZOZ_2404_33":"advico","OZOZ_2404_34":"advname","OZOZ_2404_35":"advicop","OZOZ_2404_36":"advcode","OZOZ_2404_38":"advphone","OZOZ_2404_39":"advemail"},
 "conseq/plna-moc":{"Jmeno_prijmeni_zmocnitel_PLM":"fullname","Datum_narození_zmocnitel_PLM":"birth","RC_zmocnitel_PLM":"rc","Trvale_bydliste_zmocnitel_PLM":"addr","V_zmocnitel_PLM":"place","Dne_zmocnitel_PLM":"date"},
 # ZFP Investments
 "zfpi/zadost-o-odkup-podilovych-listu":{"PRIEZVISKO  OBCHODNÉ MENO":"surname","KRSTNÉ MENO":"firstname","rodne cislo/ico":"rc","TRVALÉ BYDLISKO  SÍDLO  ULICA":"street","cislo":"cp","den":"date@d","mesiac":"date@m","rok":"date@y"},
 "zfpi/zadost-o-zmenu-udaju":{"meno":"firstname","adresa":"addr","e/mail":"email","datum a misto":"placedate",
   "meno agent":"advname","rodne cislo agent":"advicop","adresa agent":None,"telefon2":"advphone","e mail":"advemail","kod":None,"kod sprostedkovatel":"advcode"},
 "zfpi/zadost-o-prevod-podilovych-listu":{"Prevodce_prijimeni/obchodni_meno":"surname","KRSTNÉ MENO":"firstname","Prevodce_rodne_cislo/ico":"rc","Prevodce_trvale_bydlyste/sidlo_ulice":"street","Prevodce_den":"date@d","Prevodce_mesic":"date@m","Prevodce_rok":"date@y","Nabyvatel_rodne_cislo/ico":None,"Nabyvatel_krestni_jmeno":None,"Nabyvatel_trvale_bydlyste/sidlo_ulice":None,"Nabyvatel_cislo_popisne":None,"Nabyvatel_psc":None,"Nabyvatel_mesto":None},
 "zfpi/dispozicni-prava-k-podilovym-listum":{"RC/ICO_podilnik":"rc","jmeno_zprostredkovatele":"advname","mobil_zprostredkovatele":"advphone","e-mail_zprostredkovatele":"advemail","kod_zprostredkovatele":"advcode"},
 "zfpi/dodatek-dip":{"titul_pred":"title","titul_za":None,"mobil":"phone","e-mail":"email",
   "jmeno_zprostredkovatel":"advname","mobil_zprostredkovatel":"advphone","e-mail_zprostredkovatele":"advemail","kod_zprostredkovatel":"advcode","RC_zprostredkovatel":"advicop"},
 # ostatní instituce – jen jméno, telefon a e-mail poradce (získatelská čísla a kódy instituce neznám)
 "rentea/zadost-o-vyplatu-davky-odbytne":{"jméno a příjmení zprostředkovatel  2":"advname","Telefon zprostředkovatel  2":"advphone","E-mail zprostředkovatel  2":"advemail"},
 "kbps/dodatek-ke-smlouve-dps":{"Mobil poradce":"advphone","Email poradce":"advemail"},
 "kbps/oznameni":{"Jméno a pCíjmení poradce":"advname"},
 "kbps/zadost-o-davku-dps":{"fill_20":"advname"},
 "kbps/zadost-o-zmenu-spravce-smlouvy":{"Jméno a příjmení poradce":"advname"},
 "koop/zadost-o-vyber-financnich-prostredku":{"telefon_ziskatel":"advphone","mail_ziskatel":"advemail"},
 # ZFP World Index (WOOD Retail Investments)
 "zfpwi/pokyn-k-vyberu":{"fill_4":"cnum","fill_5":None},
}
# PDF bez vyplnitelných polí: údaje se dopíší na pozici za popisek (formulare.js je vykreslí do stránky).
# {"<instituce>/<soubor>": [(popisek, klíč[, "in"|"dots"])]} – "in" = popisek slepený s tečkami ("dne....."), "dots" = za popiskem musí být tečky
OVERLAYS={
 "zfpwi/vypoved-ramcove-smlouvy":[("Jméno a příjmení:","fullname"),("trvale bytem:","addr"),("rodné (identifikační) číslo:","rc"),("datum a místo narození:","birth"),("V","place","dots"),("dne","date","in")],
 "zfpwi/vypoved-ramcove-smlouvy-a-vyber":[("Jméno a příjmení:","fullname"),("trvale bytem:","addr"),("rodné (identifikační) číslo:","rc"),("datum a místo narození:","birth"),("Všechny prostředky zaslat na bankovní účet:","account"),("V","place","dots"),("dne","date","in")],
}
DOTS=re.compile(r'^[._…\-]{3,}$')
def overlay(pdf,spec):
    P=words(pdf); r=pypdf.PdfReader(pdf); out=[]; used=set()
    for lab,key,*opt in spec:
        toks=[norm(t) for t in lab.split()]; glued=bool(opt and opt[0]=="in"); hit=None
        for pi,pg in enumerate(P):
            ws=pg['w']; W=float(r.pages[pi].mediabox.width)
            for i in range(len(ws)):
                if (pi,i) in used: continue
                seq=ws[i:i+len(toks)]
                if len(seq)<len(toks): continue
                ok=all(norm(w[4])==t for w,t in zip(seq,toks)) if not glued else (len(toks)==1 and norm(ws[i][4]).startswith(toks[0]) and bool(DOTS.match(ws[i][4][len(lab):])))
                if not ok: continue
                if not glued and any(abs(w[1]-seq[0][1])>3 for w in seq): continue
                if opt and opt[0]=="dots":
                    nx=ws[i+len(toks)] if i+len(toks)<len(ws) else None
                    if not (nx and abs(nx[1]-seq[0][1])<3 and DOTS.match(nx[4])): continue
                last=seq[-1]; y0=min(w[1] for w in seq); y1=max(w[3] for w in seq)
                hgt=y1-y0; ondots=False
                if glued: x=last[0]+len(lab)*hgt*0.56+3; ondots=True
                else:
                    nxt=ws[i+len(toks)] if i+len(toks)<len(ws) else None
                    ondots=bool(nxt and abs(nxt[1]-y0)<3 and DOTS.match(nxt[4]) and nxt[0]-last[2]<20)
                    x=(nxt[0]+2) if ondots else last[2]+5
                rest=[w for w in ws if abs(w[1]-y0)<3 and w[0]>x+4 and not DOTS.match(w[4]) and not (glued and w is last)]
                x2=min([w[0]-6 for w in rest]+[W-40])
                base=y1-hgt*(0.45 if ondots else 0.22)   # na tečkách o kousek výš, ať text nesedí přímo na nich
                hit=dict(p=pi,x=round(x,1),y=round(pg['h']-base,1),w=round(max(30,x2-x),1),s=round(min(10.5,max(7,hgt*0.85)),1),k=key)
                used.add((pi,i)); break
            if hit: break
        if hit: out.append(hit)
    for i,o in enumerate(out): o["n"]="@o%d"%i
    return out
PAYKEYS={"account","accpre","bank","vs","ss"}
# změnové formuláře, kde adresa a kontakt jen identifikují klienta (nové údaje se píší jinam) – adresu předvyplnit
ADDR_ID={"conseq/zadost-o-zmenu-zrizeni-trvaleho-pokynu-k-nakupu","conseq/oznameni-o-zmene-udaju","conseq/oznameni-o-zmene-obchodniho-zastupce","conseq/plna-moc",
 "zfpi/zadost-o-zmenu-udaju","zfpi/zadost-o-prevod-podilovych-listu","zfpi/dispozicni-prava-k-podilovym-listum","zfpi/dodatek-dip"}
ADDRKEYS={"street","streetcp","cp","city","psc","addr","phone","email"}
import os, json, shutil, urllib.request, datetime
R=os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),".."))
OUT=os.path.join(R,"pipeline","formulare")
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124 Safari/537.36"
def fetch(url,dst):
    req=urllib.request.Request(url,headers={"User-Agent":UA})
    with urllib.request.urlopen(req,timeout=90) as r, open(dst+".part","wb") as f: shutil.copyfileobj(r,f)
    os.replace(dst+".part",dst)
def main():
    offline="--offline" in sys.argv
    only=set(sys.argv[sys.argv.index("--only")+1].split(",")) if "--only" in sys.argv else None
    cfg=json.load(open(os.path.join(R,"tools","formulare-zdroje.json"),encoding="utf-8"))
    OVR.update(OVERRIDES)
    old={}
    try: old={f["file"]:f for f in json.load(open(os.path.join(OUT,"index.json"),encoding="utf-8"))["forms"]}
    except Exception: pass
    forms=[];bad=[]
    for f in cfg["forms"]:
        dst=os.path.join(OUT,f["file"]); os.makedirs(os.path.dirname(dst),exist_ok=True)
        got=old.get(f["file"],{}).get("got")
        if not offline and (only is None or f["inst"] in only or not os.path.exists(dst)):
            try:
                fetch(f["src"],dst+".dl")
                with open(dst+".dl","rb") as h: head=h.read(5)
                if f["file"].endswith(".pdf") and head!=b"%PDF-": raise Exception("není PDF")
                prev=open(dst,"rb").read() if os.path.exists(dst) else None
                if f["file"].endswith(".pdf"):
                    r=subprocess.run(["qpdf","--decrypt","--deterministic-id","--object-streams=generate","--recompress-flate","--compression-level=9",dst+".dl",dst],capture_output=True)
                    if r.returncode not in (0,3) or not os.path.exists(dst): shutil.copy(dst+".dl",dst)
                else: shutil.copy(dst+".dl",dst)
                os.remove(dst+".dl")
                if prev is None or open(dst,"rb").read()!=prev or not got: got=datetime.date.today().isoformat()
            except Exception as e:
                bad.append(f'{f["file"]}: {e}')
                if os.path.exists(dst+".dl"): os.remove(dst+".dl")
                if not os.path.exists(dst): continue
        if not os.path.exists(dst): continue
        item=dict(id=f["file"].rsplit(".",1)[0].replace("/","-"),inst=f["inst"],kind=f["kind"],t=f["t"],file=f["file"],src=f["src"],got=got,size=os.path.getsize(dst))
        if f.get("web"): item["web"]=f["web"]
        if f["file"].endswith(".pdf"):
            try:
                rd=pypdf.PdfReader(dst); item["pages"]=len(rd.pages)
                res,fill=analyse(dst,f["file"].rsplit(".",1)[0])
                ovl=overlay(dst,OVERLAYS[f["file"].rsplit(".",1)[0]]) if f["file"].rsplit(".",1)[0] in OVERLAYS else []
                if ovl:
                    item["ov"]=[{k:v for k,v in o.items() if k!="k"} for o in ovl]
                    fill.update({o["n"]:o["k"] for o in ovl})
                if f["kind"] not in ("vyp","navaz"): fill={k:v for k,v in fill.items() if v not in PAYKEYS}
                if f["kind"] not in ("vyp","navaz","prevod"): fill={k:v for k,v in fill.items() if v!="newcnum"}
                if f["kind"]=="zmena" and f["file"].rsplit(".",1)[0] not in ADDR_ID: fill={k:v for k,v in fill.items() if v not in ADDRKEYS}
                if fill: item["fill"]=fill
                if "newcnum" in fill.values() and f["kind"] in ("vyp","navaz"): item["navaz"]=True
                if not rd.get_fields(): item["print"]=True
            except Exception as e: bad.append(f'{f["file"]}: mapování – {e}')
        forms.append(item)
    idx=dict(updated=max([x.get("got") or "" for x in forms]+[""]),inst=cfg["inst"],forms=forms)
    with open(os.path.join(OUT,"index.json"),"w",encoding="utf-8") as h: json.dump(idx,h,ensure_ascii=False,separators=(",",":"))
    print(f"{len(forms)} formulářů, {sum(1 for x in forms if x.get('fill'))} s předvyplněním → pipeline/formulare/index.json")
    for b in bad: print("  !",b)
    return 1 if bad else 0
if __name__=="__main__": sys.exit(main())
