{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 9,
      "minor": 0,
      "revision": 0,
      "architecture": "x64",
      "modernui": 1
    },
    "classnamespace": "box",
    "rect": [
      80.0,
      80.0,
      980.0,
      520.0
    ],
    "gridsize": [
      15.0,
      15.0
    ],
    "boxes": [
      {
        "box": {
          "id": "obj-c1",
          "patching_rect": [
            40,
            20,
            900,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "Phones play this faustgen~'s DSP and follow it as it is edited (faustwasm, docs/remote-control.md section 20, step 6).",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-c2",
          "patching_rect": [
            40,
            44,
            900,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "Needs a faustgen~ with report and wasm (grame-cncm/faust, faustgen-remote branch); with the released faustgen~, use faust-remote-v8-demo.maxpat. Max 9.2 or later (v8).",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-c3",
          "patching_rect": [
            40,
            76,
            900,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "1. Generate the phones' remote control with the same DSP, next to this patch:  faust2wasm-ts faust-remote-demo.dsp app -remote",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-c4",
          "patching_rect": [
            40,
            100,
            900,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "2. Give the v8 this computer's address on the phones' network, and  cert <file> key <file>: HTTPS, which the phone's local sound and sensors need (see the README).",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-c5",
          "patching_rect": [
            40,
            124,
            900,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "3. Open the pairing link below on a phone, tick Play locally, tap Connect. Edit the DSP (double-click faustgen~): the phones get the new one, interface and sound.",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-faust",
          "patching_rect": [
            40,
            180,
            160,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "faustgen~ @report 30",
          "numinlets": 1,
          "numoutlets": 4,
          "outlettype": [
            "signal",
            "signal",
            "",
            ""
          ],
          "sourcecode": "// The DSP of faust-remote-demo.maxpat, to generate the phones' remote\n// control with the same DSP (and play it on the phone with \"Play locally\"):\n//   faust2wasm-ts faust-remote-demo.dsp app -remote\ndeclare name \"faust-remote-demo\";\nimport(\"stdfaust.lib\");\n\nfreq = hslider(\"freq [acc: 0 0 -10 0 10]\", 440, 110, 880, 1);\ngain = hslider(\"gain\", 0.2, 0, 1, 0.01);\nplay = checkbox(\"play\");\nlevel = an.amp_follower(0.1) : hbargraph(\"level\", 0, 1);\n\nprocess = os.osc(freq) * gain * play <: attach(_, level), _;\n",
          "sourcecode_size": 508
        }
      },
      {
        "box": {
          "id": "obj-c6",
          "patching_rect": [
            220,
            180,
            520,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "@report 30: the controls and bargraphs that changed, its JSON with each new DSP, all on its control outlet: no faust-json.js, no dump.",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-dac",
          "patching_rect": [
            40,
            230,
            45,
            45.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "ezdac~",
          "numinlets": 2,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-node",
          "patching_rect": [
            120,
            300,
            640,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "v8 faust-remote-v8.js root app address 192.168.1.20 dump 0",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-route",
          "patching_rect": [
            120,
            350,
            400,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "route param midi dump getjson link clients wasm",
          "numinlets": 1,
          "numoutlets": 8,
          "outlettype": [
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-midi",
          "patching_rect": [
            120,
            400,
            110,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "prepend midievent",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-dump",
          "patching_rect": [
            240,
            400,
            50,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "message",
          "text": "dump",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-json",
          "patching_rect": [
            300,
            400,
            40,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "message",
          "text": "json",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-set",
          "patching_rect": [
            350,
            400,
            80,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "prepend set",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-clients",
          "patching_rect": [
            440,
            400,
            50,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "number",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "",
            "bang"
          ],
          "parameter_enable": 0
        }
      },
      {
        "box": {
          "id": "obj-wasm",
          "patching_rect": [
            500,
            400,
            95,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "prepend wasm",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-link",
          "patching_rect": [
            350,
            440,
            600,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "message",
          "text": "",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-c7",
          "patching_rect": [
            500,
            350,
            440,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "getjson: faustgen~ answers json on its control outlet",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-c8",
          "patching_rect": [
            600,
            400,
            360,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "where faustgen~ writes each DSP compiled for the phones",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-c9",
          "patching_rect": [
            440,
            425,
            120,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "phones",
          "numinlets": 1,
          "numoutlets": 0
        }
      }
    ],
    "lines": [
      {
        "patchline": {
          "source": [
            "obj-faust",
            0
          ],
          "destination": [
            "obj-dac",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-faust",
            1
          ],
          "destination": [
            "obj-dac",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-faust",
            2
          ],
          "destination": [
            "obj-node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-node",
            0
          ],
          "destination": [
            "obj-route",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-route",
            0
          ],
          "destination": [
            "obj-faust",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-route",
            1
          ],
          "destination": [
            "obj-midi",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-midi",
            0
          ],
          "destination": [
            "obj-faust",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-route",
            2
          ],
          "destination": [
            "obj-dump",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-dump",
            0
          ],
          "destination": [
            "obj-faust",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-route",
            3
          ],
          "destination": [
            "obj-json",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-json",
            0
          ],
          "destination": [
            "obj-faust",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-route",
            4
          ],
          "destination": [
            "obj-set",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-set",
            0
          ],
          "destination": [
            "obj-link",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-route",
            5
          ],
          "destination": [
            "obj-clients",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-route",
            6
          ],
          "destination": [
            "obj-wasm",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-wasm",
            0
          ],
          "destination": [
            "obj-faust",
            0
          ]
        }
      }
    ]
  }
}