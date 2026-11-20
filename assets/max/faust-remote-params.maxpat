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
      940.0,
      680.0
    ],
    "gridsize": [
      15.0,
      15.0
    ],
    "boxes": [
      {
        "box": {
          "id": "c1",
          "patching_rect": [
            40,
            20,
            860,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "Phones drive this patch's named parameters (faustwasm, docs/remote-control.md section 20).",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "c2",
          "patching_rect": [
            40,
            46,
            860,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "1. Generate the phones' remote control from the Faust interface, next to this patch:  faust2wasm-ts faust-remote-params.dsp params-app -remote",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "c3",
          "patching_rect": [
            40,
            72,
            860,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "comment",
          "text": "2. Open the pairing link below on a phone. Without  ui ...  in the @args, the phone shows every named parameter, from faust-params.js.",
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "freq",
          "patching_rect": [
            40,
            120,
            44,
            47
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "",
            "float"
          ],
          "parameter_enable": 1,
          "varname": "freq",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "freq",
              "parameter_shortname": "freq",
              "parameter_type": 0,
              "parameter_mmin": 110.0,
              "parameter_mmax": 880.0,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                440.0
              ]
            }
          }
        }
      },
      {
        "box": {
          "id": "gain",
          "patching_rect": [
            110,
            120,
            44,
            47
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "",
            "float"
          ],
          "parameter_enable": 1,
          "varname": "gain",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "gain",
              "parameter_shortname": "gain",
              "parameter_type": 0,
              "parameter_mmin": 0.0,
              "parameter_mmax": 1.0,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                0.2
              ]
            }
          }
        }
      },
      {
        "box": {
          "id": "play",
          "patching_rect": [
            180,
            130,
            15,
            15
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "live.toggle",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "parameter_enable": 1,
          "varname": "play",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "play",
              "parameter_shortname": "play",
              "parameter_type": 2,
              "parameter_mmax": 1.0,
              "parameter_enum": [
                "off",
                "on"
              ],
              "parameter_initial_enable": 1,
              "parameter_initial": [
                0.0
              ]
            }
          }
        }
      },
      {
        "box": {
          "id": "osc",
          "patching_rect": [
            40,
            200,
            60,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "cycle~ 440",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ]
        }
      },
      {
        "box": {
          "id": "g1",
          "patching_rect": [
            40,
            240,
            40,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "*~",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ]
        }
      },
      {
        "box": {
          "id": "g2",
          "patching_rect": [
            40,
            280,
            40,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "*~",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ]
        }
      },
      {
        "box": {
          "id": "dac",
          "patching_rect": [
            40,
            330,
            45,
            45
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
          "id": "peak",
          "patching_rect": [
            220,
            330,
            90,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "peakamp~ 50",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "float"
          ]
        }
      },
      {
        "box": {
          "id": "meter",
          "patching_rect": [
            220,
            370,
            120,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "prepend meter level",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "params",
          "patching_rect": [
            220,
            420,
            200,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "js faust-params.js meters level",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "node",
          "patching_rect": [
            220,
            470,
            520,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "node.script faust-remote.js @autostart 1 @args target params root params-app ui params-app/dsp-meta.json",
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
          "id": "route",
          "patching_rect": [
            220,
            520,
            260,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "route pset midi getjson link clients",
          "numinlets": 1,
          "numoutlets": 6,
          "outlettype": [
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
          "id": "pset",
          "patching_rect": [
            220,
            560,
            80,
            22.0
          ],
          "fontname": "Arial",
          "fontsize": 12.0,
          "maxclass": "newobj",
          "text": "prepend pset",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "getjson",
          "patching_rect": [
            310,
            560,
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
          "id": "set",
          "patching_rect": [
            380,
            560,
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
          "id": "link",
          "patching_rect": [
            380,
            600,
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
          "id": "clients",
          "patching_rect": [
            470,
            560,
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
      }
    ],
    "lines": [
      {
        "patchline": {
          "source": [
            "freq",
            0
          ],
          "destination": [
            "osc",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "osc",
            0
          ],
          "destination": [
            "g1",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "gain",
            0
          ],
          "destination": [
            "g1",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "g1",
            0
          ],
          "destination": [
            "g2",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "play",
            0
          ],
          "destination": [
            "g2",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "g2",
            0
          ],
          "destination": [
            "dac",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "g2",
            0
          ],
          "destination": [
            "dac",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "g2",
            0
          ],
          "destination": [
            "peak",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "meter",
            0
          ],
          "destination": [
            "params",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "params",
            0
          ],
          "destination": [
            "node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "node",
            0
          ],
          "destination": [
            "route",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "route",
            0
          ],
          "destination": [
            "pset",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "pset",
            0
          ],
          "destination": [
            "params",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "route",
            2
          ],
          "destination": [
            "getjson",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "getjson",
            0
          ],
          "destination": [
            "params",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "route",
            3
          ],
          "destination": [
            "set",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "set",
            0
          ],
          "destination": [
            "link",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "route",
            4
          ],
          "destination": [
            "clients",
            0
          ]
        }
      }
    ]
  }
}