#!/usr/bin/env python3
"""
Draws the connection diagrams of section 20 of docs/remote-control.md
(phone <-> Max patch) as SVG files next to this script, in English
(`max-*.svg`, for docs/remote-control.md) and in French (`max-*.fr.svg`,
for docs/remote-control.fr.md).

    python3 docs/images/make-max-diagrams.py

Labels are written in English; FR maps each one to its French version
(code, object names and messages Max shows as they are stay untranslated).

No dependency: the SVG is written by hand, so that the figures can be
regenerated and changed with the text.
"""
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent
W = 1000

FR = {
    # Shared
    "Phone": "Téléphone",
    "remote control PWA": "PWA télécommande",
    "controls, bargraphs": "contrôles, bargraphs",
    "sensors": "capteurs",
    "local DSP (wasm)": "DSP local (wasm)",
    "its own sound": "son propre son",
    "Max patch": "Patch Max",
    "path value": "chemin valeur",
    "faustgen~ adapter": "adaptateur faustgen~",
    "WebRTC data channels": "Canaux de données WebRTC",
    "or WebSocket relay": "ou relais WebSocket",
    "over HTTPS": "sur HTTPS",
    "HTTPS: PWA files and signaling": "HTTPS : fichiers de la PWA et signalisation",
    "WebRTC or relay": "WebRTC ou relais",
    "v8 or node.script": "v8 ou node.script",
    # 1
    "1 · node.script (Max 8 and 9)": "1 · node.script (Max 8 et 9)",
    "The existing server and host run unchanged in Node for Max, a separate process driven by the patch.":
        "Le serveur et l'hôte existants tournent sans changement dans Node for Max, un processus séparé piloté par le patch.",
    "node-datachannel, installed by the user": "node-datachannel, installé par l'utilisateur",
    "over HTTPS, always available": "sur HTTPS, toujours disponible",
    "(HTTPS, signaling, relay)": "(HTTPS, signalisation, relais)",
    "separate Node process": "processus Node séparé",
    "max-api messages, on the scheduler thread": "messages max-api, sur le fil de l'ordonnanceur",
    # 2
    "2 · v8 object (Max 9.2 and later)": "2 · Objet v8 (Max 9.2 et suivantes)",
    "One file in the patch: http/https and WebSocketServer in Max's own JavaScript, but no WebRTC.":
        "Un fichier dans le patch : http/https et WebSocketServer dans le JavaScript de Max, mais pas de WebRTC.",
    "WebSocket relay only": "Relais WebSocket seulement",
    "over HTTPS (mkcert key and certificate)": "sur HTTPS (clé et certificat mkcert)",
    "no WebRTC:": "pas de WebRTC :",
    "v8 has no RTCPeerConnection": "v8 n'a pas de RTCPeerConnection",
    "(File for the PWA's files)": "(File pour les fichiers de la PWA)",
    "Max main (low-priority) thread": "fil principal (basse priorité) de Max",
    "shims needed: EventTarget, performance.now, crypto": "cales nécessaires : EventTarget, performance.now, crypto",
    # 3
    "3 · Server mode inside faustgen~ (C++)": "3 · Mode serveur dans faustgen~ (C++)",
    "One object, nothing else to install; the protocol and the host's rules rewritten in C++.":
        "Un seul objet, rien d'autre à installer ; le protocole et les règles de l'hôte réécrits en C++.",
    "libdatachannel, inside the external": "libdatachannel, dans l'external",
    "HTTPS: PWA files from the Max package": "HTTPS : fichiers de la PWA du package Max",
    "network": "réseau",
    "C++ host": "hôte C++",
    "RemoteUI: policies,": "RemoteUI : politiques,",
    "groups, sensors": "groupes, capteurs",
    "timed values applied inside the block": "valeurs horodatées appliquées dans le bloc",
    "sample-accurate": "mode horodaté",
    "timed mode": "à l'échantillon",
    "the same remote control for every native Faust target, if written as a RemoteUI":
        "la même télécommande pour toutes les cibles Faust natives, si écrit comme RemoteUI",
    # 4
    "4 · Any patch, through its named parameters": "4 · N'importe quel patch, à travers ses paramètres nommés",
    "The adapter builds the phone's interface from the patch's parameters, or from an interface-only .dsp.":
        "L'adaptateur construit l'interface du téléphone à partir des paramètres du patch, ou d'un .dsp d'interface seule.",
    "relay only": "relais seulement",
    "server + FaustRemoteHost": "serveur + FaustRemoteHost",
    "parameters adapter": "adaptateur paramètres",
    "(Faust JSON built from": "(JSON Faust tiré de",
    "or: a .dsp made only of widgets": "ou : un .dsp fait seulement de widgets",
    "(groups, [acc:], [remote:off],": "(groupes, [acc:], [remote:off],",
    "bargraphs), its paths named": "bargraphs), ses chemins portant",
    "after the parameters": "les noms des paramètres",
    # 5
    "5 · WebRTC-to-OSC gateway, no change in Max": "5 · Passerelle WebRTC vers OSC, sans rien changer dans Max",
    "faust-remote-server, outside Max, hosts the session and speaks OSC to faustgen~ or to any -osc application.":
        "faust-remote-server, hors de Max, héberge la session et parle OSC à faustgen~ ou à toute application -osc.",
    "(Node, outside Max)": "(Node, hors de Max)",
    "OSC target": "cible OSC",
    "sensors mapped here": "capteurs traduits ici",
    "OSC over UDP": "OSC sur UDP",
    "or any app built with -osc": "ou toute application -osc",
    # 6
    "6 · One source, two compilations": "6 · Un source, deux compilations",
    "faustgen~ compiles each DSP to LLVM IR for Max and to wasm for the phones, which then play it too.":
        "faustgen~ compile chaque DSP en IR LLVM pour Max et en wasm pour les téléphones, qui le jouent aussi.",
    "Faust source": "Source Faust",
    "faustgen~ editor": "éditeur de faustgen~",
    "LLVM IR, JIT": "IR LLVM, JIT",
    "wasm backend": "backend wasm",
    "server + host": "serveur + hôte",
    "serves the files": "sert les fichiers",
    "and the controls": "et les contrôles",
    "Max plays the LLVM code": "Max joue le code LLVM",
    "(the reference sound)": "(le son de référence)",
    "written at each": "écrits à chaque",
    "controls, both ways": "contrôles, dans les deux sens",
    "wasm and JSON, fetched with the hash": "wasm et JSON, chargés avec l'empreinte",
    "\"dsp\" message: the DSP changed": "message « dsp » : le DSP a changé",
    "same paths, ranges and metadata on both sides; the same DSP, not the same samples":
        "mêmes chemins, plages et métadonnées des deux côtés ; le même DSP, pas les mêmes échantillons",
}

# The language being drawn: its labels, and the suffix of its files
LABELS = {}
SUFFIX = ""

C = {
    "ink": "#1f2328",
    "muted": "#57606a",
    "phone": "#ddeaff",
    "phone_edge": "#2f6fd6",
    "server": "#fff1d6",
    "server_edge": "#c77d00",
    "dsp": "#dff3e4",
    "dsp_edge": "#2e8b57",
    "max": "#f4f4f5",
    "max_edge": "#6e7781",
    "obj": "#ffffff",
    "net": "#3d4451",
    "warn": "#b42318",
}


class Svg:
    def __init__(self, height, title, subtitle):
        self.h = height
        self.parts = []
        self.text(24, 34, title, size=19, weight="700")
        self.text(24, 56, subtitle, size=13, fill=C["muted"])

    # ---------------------------------------------------------- primitives

    def text(self, x, y, s, size=13, weight="400", fill=None, anchor="start",
             italic=False, mono=False):
        family = ("ui-monospace, SFMono-Regular, Menlo, monospace" if mono
                  else "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif")
        style = ' font-style="italic"' if italic else ""
        s = LABELS.get(s, s)
        self.parts.append(
            f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill or C["ink"]}" '
            f'text-anchor="{anchor}"{style}>{escape(s)}</text>')

    def rect(self, x, y, w, h, fill, edge, r=10, dash=None, width=1.5):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.parts.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" '
            f'fill="{fill}" stroke="{edge}" stroke-width="{width}"{d}/>')

    def line(self, pts, color=None, dash=None, width=2, start=False, end=True):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        ms = ' marker-start="url(#a0)"' if start else ""
        me = ' marker-end="url(#a1)"' if end else ""
        path = " ".join(("M" if i == 0 else "L") + f"{x},{y}" for i, (x, y) in enumerate(pts))
        self.parts.append(
            f'<path d="{path}" fill="none" stroke="{color or C["net"]}" '
            f'stroke-width="{width}"{d}{ms}{me}/>')

    # ---------------------------------------------------------- components

    def box(self, x, y, w, h, title, lines=(), kind="server", mono_title=False,
            dash=None, title_size=14):
        fill, edge = {
            "server": (C["server"], C["server_edge"]),
            "dsp": (C["dsp"], C["dsp_edge"]),
            "phone": (C["phone"], C["phone_edge"]),
            "plain": (C["obj"], C["max_edge"]),
        }[kind]
        self.rect(x, y, w, h, fill, edge, dash=dash)
        self.text(x + w / 2, y + 22, title, size=title_size, weight="700",
                  anchor="middle", mono=mono_title)
        for i, s in enumerate(lines):
            self.text(x + w / 2, y + 42 + 18 * i, s, size=12, anchor="middle",
                      fill=C["muted"] if s.startswith("(") else C["ink"])

    def maxobj(self, x, y, w, label, inlets=2, outlets=2, h=26):
        """A Max object box: label in a box, inlets on top, outlets below."""
        self.rect(x, y, w, h, C["obj"], C["ink"], r=4, width=1.3)
        for i in range(inlets):
            ix = x + 3 + (w - 14) * (i / max(1, inlets - 1) if inlets > 1 else 0)
            self.parts.append(f'<rect x="{ix}" y="{y}" width="8" height="3" fill="{C["ink"]}"/>')
        for i in range(outlets):
            ox = x + 3 + (w - 14) * (i / max(1, outlets - 1) if outlets > 1 else 0)
            self.parts.append(f'<rect x="{ox}" y="{y + h - 3}" width="8" height="3" fill="{C["ink"]}"/>')
        self.text(x + 8, y + 18, label, size=12, mono=True)

    def cord(self, pts, label=None, lx=None, ly=None, signal=False):
        """A patch cord; signal cords are drawn striped, as in Max."""
        color = "#7a8f2a" if signal else C["ink"]
        self.line(pts, color=color, width=2 if signal else 1.4,
                  dash="6 3" if signal else None, end=False)
        if label:
            self.text(lx, ly, label, size=11, fill=C["muted"], mono=True)

    def phone(self, x, y, local_dsp=False, h=300):
        w = 180
        self.rect(x, y, w, h, "#ffffff", C["phone_edge"], r=24, width=2.2)
        self.rect(x + w / 2 - 28, y + 9, 56, 7, C["phone_edge"], C["phone_edge"], r=3.5)
        self.text(x + w / 2, y + 40, "Phone", size=15, weight="700", anchor="middle")
        self.text(x + w / 2, y + 58, "remote control PWA", size=12, anchor="middle",
                  fill=C["muted"])
        items = [("faust-ui", "controls, bargraphs"),
                 ("sensors", "[acc:] [gyr:]")]
        if local_dsp:
            items.append(("local DSP (wasm)", "its own sound"))
        for i, (a, b) in enumerate(items):
            yy = y + 76 + 62 * i
            kind = "dsp" if a.startswith("local") else "phone"
            self.box(x + 14, yy, w - 28, 50, a, [b], kind=kind, title_size=13)
        self.text(x + w / 2, y + h - 18, "client.js", size=12, anchor="middle",
                  mono=True, fill=C["muted"])

    def maxpatch(self, x, y, w, h, title="Max patch"):
        self.rect(x, y, w, h, C["max"], C["max_edge"], r=8, width=1.6)
        self.rect(x, y, w, 26, "#e4e5e7", C["max_edge"], r=8, width=1.6)
        self.parts.append(f'<rect x="{x + 1}" y="{y + 16}" width="{w - 2}" height="10" fill="#e4e5e7"/>')
        self.text(x + 14, y + 18, title, size=12, weight="700", fill=C["muted"])

    def link(self, x1, x2, y, label, sub=None, dash=None, color=None):
        """A two-way network link with its label above and an optional note below."""
        self.line([(x1, y), (x2, y)], color=color, dash=dash, width=2.4, start=True, end=True)
        self.text((x1 + x2) / 2, y - 9, label, size=12, weight="600", anchor="middle",
                  fill=color or C["net"])
        if sub:
            self.text((x1 + x2) / 2, y + 18, sub, size=11, anchor="middle", fill=C["muted"])

    def note(self, x, y, s, color=None, size=12, anchor="start", italic=True):
        self.text(x, y, s, size=size, fill=color or C["muted"], italic=italic, anchor=anchor)

    def save(self, name):
        defs = (
            '<defs>'
            '<marker id="a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
            f'<path d="M0,0 L10,5 L0,10 z" fill="{C["net"]}"/></marker>'
            '<marker id="a0" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
            f'<path d="M10,0 L0,5 L10,10 z" fill="{C["net"]}"/></marker>'
            '</defs>')
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{self.h}" '
               f'viewBox="0 0 {W} {self.h}">{defs}'
               f'<rect width="{W}" height="{self.h}" fill="#ffffff"/>'
               + "".join(self.parts) + "</svg>\n")
        path = OUT / name.replace(".svg", SUFFIX + ".svg")
        path.write_text(svg, encoding="utf-8")
        print("wrote", path)


def dac_chain(s, x, y, label="faustgen~ mysynth", w=170):
    """faustgen~ with its outlets, its audio to dac~."""
    s.maxobj(x, y, w, label, inlets=1, outlets=3)
    s.maxobj(x, y + 70, 70, "dac~", inlets=2, outlets=0)
    s.cord([(x + 7, y + 26), (x + 7, y + 70)], signal=True)


def js_host(s, title, lines, thread_note, footer):
    """The Max side of diagrams 1 and 2: a JavaScript object hosting the
    session, faustgen~ fed by it, and its control outlet thinned back."""
    s.maxpatch(476, 80, 502, 330)
    s.box(494, 136, 240, 140, title, lines, mono_title=True, title_size=13)
    # The object's inlet and outlet
    s.parts.append(f'<rect x="498" y="136" width="10" height="3" fill="{C["ink"]}"/>')
    s.parts.append(f'<rect x="498" y="273" width="10" height="3" fill="{C["ink"]}"/>')
    s.note(614, 262, thread_note, anchor="middle")
    s.maxobj(790, 126, 150, "speedlim 30", inlets=2, outlets=1)
    s.maxobj(790, 306, 170, "faustgen~ mysynth", inlets=1, outlets=3)
    s.maxobj(790, 366, 70, "dac~", inlets=2, outlets=0)
    s.cord([(797, 332), (797, 366)], signal=True)
    # Writes: object outlet -> faustgen~ inlet
    s.cord([(503, 276), (503, 292), (797, 292), (797, 306)], "path value", 600, 286)
    # Bargraphs: faustgen~ control outlet -> speedlim -> object inlet
    s.cord([(872, 332), (872, 346), (962, 346), (962, 116), (797, 116), (797, 126)],
           "path cur min max", 868, 362)
    s.cord([(797, 152), (797, 162), (752, 162), (752, 124), (503, 124), (503, 136)])
    s.note(705, 404, footer, anchor="middle")


# ------------------------------------------------------------------ 1

def node_script():
    s = Svg(430, "1 · node.script (Max 8 and 9)",
            "The existing server and host run unchanged in Node for Max, a separate process driven by the patch.")
    s.phone(24, 92)
    s.link(214, 466, 178, "WebRTC data channels", "node-datachannel, installed by the user")
    s.link(214, 466, 262, "or WebSocket relay", "over HTTPS, always available", dash="7 5")
    s.note(340, 330, "HTTPS: PWA files and signaling", anchor="middle")
    js_host(s, "node.script faust-remote.js",
            ["faust-remote-server", "(HTTPS, signaling, relay)", "FaustRemoteHost", "faustgen~ adapter"],
            "separate Node process", "max-api messages, on the scheduler thread")
    s.save("max-1-node-script.svg")


# ------------------------------------------------------------------ 2

def v8():
    s = Svg(430, "2 · v8 object (Max 9.2 and later)",
            "One file in the patch: http/https and WebSocketServer in Max's own JavaScript, but no WebRTC.")
    s.phone(24, 92)
    s.link(214, 466, 200, "WebSocket relay only", "over HTTPS (mkcert key and certificate)")
    s.text(340, 256, "no WebRTC:", size=12, anchor="middle", fill=C["warn"], weight="600")
    s.text(340, 272, "v8 has no RTCPeerConnection", size=12, anchor="middle", fill=C["warn"],
           weight="600")
    s.note(340, 330, "HTTPS: PWA files and signaling", anchor="middle")
    js_host(s, "v8 faust-remote.js",
            ["http / https + WebSocketServer", "(File for the PWA's files)", "FaustRemoteHost",
             "faustgen~ adapter"],
            "Max main (low-priority) thread", "shims needed: EventTarget, performance.now, crypto")
    s.save("max-2-v8.svg")


# ------------------------------------------------------------------ 3

def faustgen_server():
    s = Svg(430, "3 · Server mode inside faustgen~ (C++)",
            "One object, nothing else to install; the protocol and the host's rules rewritten in C++.")
    s.phone(24, 92)
    s.link(214, 466, 178, "WebRTC data channels", "libdatachannel, inside the external")
    s.link(214, 466, 262, "or WebSocket relay", "over HTTPS", dash="7 5")
    s.note(340, 330, "HTTPS: PWA files from the Max package", anchor="middle")
    s.maxpatch(476, 80, 502, 330)
    s.rect(494, 108, 340, 214, C["obj"], C["ink"], r=6, width=1.6)
    s.parts.append(f'<rect x="498" y="319" width="10" height="3" fill="{C["ink"]}"/>')
    s.text(510, 130, "faustgen~ mysynth @remote 1", size=13, mono=True, weight="700")
    s.box(510, 144, 150, 92, "network", ["HTTP, WebSocket,", "WebRTC"], kind="server", title_size=13)
    s.box(672, 144, 150, 92, "C++ host", ["RemoteUI: policies,", "groups, sensors"], kind="server",
          title_size=13)
    s.box(510, 248, 312, 60, "DSP, LLVM JIT", ["timed values applied inside the block"], kind="dsp",
          title_size=13)
    s.maxobj(494, 350, 70, "dac~", inlets=2, outlets=0)
    s.cord([(503, 322), (503, 350)], signal=True)
    s.note(860, 200, "sample-accurate", size=12)
    s.note(860, 216, "timed mode", size=12)
    s.note(727, 400, "the same remote control for every native Faust target, if written as a RemoteUI",
           anchor="middle")
    s.save("max-3-faustgen-server.svg")


# ------------------------------------------------------------------ 4

def parameters():
    s = Svg(430, "4 · Any patch, through its named parameters",
            "The adapter builds the phone's interface from the patch's parameters, or from an interface-only .dsp.")
    s.phone(24, 92)
    s.link(214, 466, 178, "WebRTC or relay", "node.script")
    s.link(214, 466, 262, "relay only", "v8", dash="7 5")
    s.maxpatch(476, 80, 502, 330)
    s.box(494, 112, 220, 132, "v8 or node.script",
          ["server + FaustRemoteHost", "parameters adapter", "(Faust JSON built from", "ParameterInfoProvider)"],
          mono_title=True, title_size=13)
    ys = (112, 160, 208)
    for y, label in zip(ys, ("live.dial cutoff", "live.slider gain", "live.toggle play")):
        s.maxobj(770, y, 160, label, inlets=1, outlets=2)
        s.line([(714, 178), (770, y + 13)], color=C["muted"], dash="3 4", width=1.3,
               start=False, end=True)
        # Each parameter feeds the sound chain through a bus on the right
        s.cord([(777, y + 26), (777, y + 34), (952, y + 34)])
    s.cord([(952, 146), (952, 290), (919, 290), (919, 300)])
    s.note(722, 268, "ParameterListener / Maxobj", size=11)
    s.maxobj(770, 300, 160, "lores~  *~  ...", inlets=3, outlets=1)
    s.maxobj(770, 362, 70, "dac~", inlets=2, outlets=0)
    s.cord([(777, 326), (777, 362)], signal=True)
    s.note(494, 300, "or: a .dsp made only of widgets", size=12)
    s.note(494, 318, "(groups, [acc:], [remote:off],", size=12)
    s.note(494, 336, "bargraphs), its paths named", size=12)
    s.note(494, 354, "after the parameters", size=12)
    s.save("max-4-parameters.svg")


# ------------------------------------------------------------------ 5

def osc_gateway():
    s = Svg(430, "5 · WebRTC-to-OSC gateway, no change in Max",
            "faust-remote-server, outside Max, hosts the session and speaks OSC to faustgen~ or to any -osc application.")
    s.phone(24, 92)
    s.link(214, 330, 220, "WebRTC or relay", "HTTPS")
    s.box(340, 130, 220, 170, "faust-remote-server",
          ["(Node, outside Max)", "FaustRemoteHost", "OSC target", "sensors mapped here"],
          mono_title=True, title_size=13)
    s.link(560, 690, 220, "OSC over UDP", "localhost 5510 / 5511")
    s.maxpatch(700, 80, 278, 330)
    s.maxobj(720, 130, 238, "osc localhost 5510 5511 1 0", inlets=1, outlets=1)
    s.cord([(727, 156), (727, 200)])
    dac_chain(s, 720, 200, w=200)
    s.note(839, 392, "or any app built with -osc", anchor="middle")
    s.save("max-5-osc-gateway.svg")


# ------------------------------------------------------------------ 6

def two_compilations():
    s = Svg(480, "6 · One source, two compilations",
            "faustgen~ compiles each DSP to LLVM IR for Max and to wasm for the phones, which then play it too.")
    s.box(370, 76, 260, 56, "Faust source", ["faustgen~ editor"], kind="plain")
    s.line([(450, 132), (300, 176)])
    s.line([(550, 132), (680, 176)])
    s.note(330, 152, "LLVM IR, JIT", anchor="end", italic=False)
    s.note(650, 152, "wasm backend", italic=False)
    # Max side
    s.maxpatch(40, 176, 420, 250)
    s.maxobj(64, 220, 170, "faustgen~ mysynth", inlets=1, outlets=3)
    s.maxobj(64, 290, 70, "dac~", inlets=2, outlets=0)
    s.cord([(71, 246), (71, 290)], signal=True)
    s.box(280, 212, 160, 176, "server + host", ["v8 or node.script", "serves the files", "and the controls"],
          title_size=13)
    s.cord([(234, 233), (280, 233)])
    s.note(64, 360, "Max plays the LLVM code", size=12)
    s.note(64, 378, "(the reference sound)", size=12)
    # Files
    s.box(560, 176, 220, 64, "dsp-module.wasm", ["dsp-meta.json (JSON)"], kind="dsp",
          mono_title=True, title_size=13)
    s.line([(560, 222), (440, 250)])
    s.note(508, 204, "written at each", size=11, anchor="middle")
    s.note(508, 218, "compilation", size=11, anchor="middle")
    # Phone
    s.phone(800, 150, local_dsp=True, h=300)
    s.link(440, 800, 300, "controls, both ways", None)
    s.line([(440, 340), (800, 340)], dash="7 5", width=2)
    s.text(620, 332, "wasm and JSON, fetched with the hash", size=12, anchor="middle", fill=C["net"],
           weight="600")
    s.line([(440, 372), (800, 372)], width=1.6)
    s.text(620, 364, "\"dsp\" message: the DSP changed", size=12, anchor="middle", fill=C["net"])
    s.note(500, 466, "same paths, ranges and metadata on both sides; the same DSP, not the same samples",
           anchor="middle")
    s.save("max-6-two-compilations.svg")


if __name__ == "__main__":
    for LABELS, SUFFIX in (({}, ""), (FR, ".fr")):
        node_script()
        v8()
        faustgen_server()
        parameters()
        osc_gateway()
        two_compilations()
