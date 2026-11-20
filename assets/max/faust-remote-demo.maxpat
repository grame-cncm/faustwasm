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
      920.0,
      620.0
    ],
    "gridsize": [
      15.0,
      15.0
    ],
    "boxes": [
      {
        "box": {
          "id": "obj-json",
          "patching_rect": [
            40,
            300,
            120,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "js faust-json.js",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-faust",
          "patching_rect": [
            40,
            230,
            160,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "faustgen~",
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
          "id": "obj-node",
          "patching_rect": [
            40,
            350,
            420,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "node.script faust-remote.js @autostart 1 @args root app",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "",
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-route",
          "patching_rect": [
            40,
            400,
            330,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "route param midi dump getjson link clients",
          "numinlets": 1,
          "numoutlets": 7,
          "outlettype": [
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
            110,
            440,
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
            230,
            440,
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
          "id": "obj-getjson",
          "patching_rect": [
            290,
            440,
            60,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "message",
          "text": "getjson",
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
            360,
            440,
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
          "id": "obj-link",
          "patching_rect": [
            360,
            480,
            520,
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
          "id": "obj-clients",
          "patching_rect": [
            440,
            440,
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
          "id": "obj-dac",
          "patching_rect": [
            40,
            520,
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
          "id": "obj-start",
          "patching_rect": [
            480,
            310,
            70,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "message",
          "text": "script start",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-stop",
          "patching_rect": [
            560,
            310,
            70,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "message",
          "text": "script stop",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-c1",
          "patching_rect": [
            40,
            20,
            840,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "Remote control of this faustgen~ from phones (faustwasm, docs/remote-control.md section 20).",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-c2",
          "patching_rect": [
            40,
            46,
            840,
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
          "id": "obj-c3",
          "patching_rect": [
            40,
            72,
            840,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "2. Phones need HTTPS for their sensors: add  cert <file> key <file>  to the node.script @args (see the README, Testing with a phone).",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-c4",
          "patching_rect": [
            40,
            98,
            840,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "3. Open the pairing link below on a phone (same network), tap Connect. Edit the DSP: the phones reconnect to the new one.",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-c5",
          "patching_rect": [
            500,
            400,
            200,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "phones connected",
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
            "obj-getjson",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-getjson",
            0
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
            "obj-start",
            0
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
            "obj-stop",
            0
          ],
          "destination": [
            "obj-node",
            0
          ]
        }
      }
    ]
  }
}