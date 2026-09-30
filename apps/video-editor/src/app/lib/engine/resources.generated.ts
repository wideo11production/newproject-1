// ============================================================================
// GENERATED FILE - DO NOT EDIT BY HAND
// ============================================================================
//
// Produced by `tools/gen-editor-resources.mjs` from the stock sample
// resources in `apps/video-editor/src/app/resources/samples/stock`. Re-run
// the generator after adding a resource there; editing this file loses the
// change on the next run.
//
// Every number below comes out of a resource file. None of it is invented.

/** A stock colour grade, mapped onto CSS filter controls. */
export interface StockColourFilter {
  id: string;
  label: string;
  kind: string;
  params: {
    brightness: number;
    contrast: number;
    saturate: number;
    hue: number;
    blur: number;
    grayscale: number;
    sepia: number;
    invert: number;
    temperature: number;
  };
}

/** A stock Ken Burns envelope: a start and end zoom plus a pan. */
export interface StockPanZoom {
  id: string;
  label: string;
  interpolation: string;
  zoomStart: number;
  zoomEnd: number;
  panX: number;
  panY: number;
}

/** A stock picture-in-picture layout, read straight off its affine matrix. */
export interface StockPip {
  id: string;
  label: string;
  scale: number;
  scaleY: number;
  x: number;
  y: number;
}

/** A stock audio effect. `params` is the file's own payload, verbatim. */
export interface StockAudioEffect {
  id: string;
  label: string;
  group: 'effect' | 'enhance';
  className: string;
  nodeClass: string;
  params: Record<string, unknown>;
}

export interface StockTitle {
  id: string;
  label: string;
  description: string;
  category: string;
  downloadable: boolean;
}

export interface StockSound {
  id: string;
  file: string;
}

export const stockColourFilters: StockColourFilter[] = [
  {
    "id": "01_TOP_Denoise",
    "label": "Denoise",
    "kind": "Effect::VideoDenoise",
    "params": {
      "brightness": 1,
      "contrast": 1,
      "saturate": 1,
      "hue": 0,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": 0
    }
  },
  {
    "id": "02_TOP_AutoContrast",
    "label": "AutoContrast",
    "kind": "Effect::AutoContrast",
    "params": {
      "brightness": 1,
      "contrast": 1,
      "saturate": 1,
      "hue": 0,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": 0
    }
  },
  {
    "id": "03_TOP_AutoSaturation",
    "label": "AutoSaturation",
    "kind": "Effect::AutoSaturation",
    "params": {
      "brightness": 1,
      "contrast": 1,
      "saturate": 1,
      "hue": 0,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": 0
    }
  },
  {
    "id": "04_TOP_AutoWhiteBalance",
    "label": "AutoWhiteBalance",
    "kind": "Effect::WhiteBalance",
    "params": {
      "brightness": 1,
      "contrast": 1,
      "saturate": 1,
      "hue": 0,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": 0
    }
  },
  {
    "id": "05_TOP_MagicEnhance",
    "label": "MagicEnhance",
    "kind": "Effect::MagicEnhance",
    "params": {
      "brightness": 1,
      "contrast": 1,
      "saturate": 1,
      "hue": 0,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": 0
    }
  },
  {
    "id": "Preset_BlueMoon",
    "label": "BlueMoon",
    "kind": "Effect::ManualEnhance",
    "params": {
      "brightness": 0.638,
      "contrast": 1.095,
      "saturate": 1.144,
      "hue": -9.3,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": -0.56
    }
  },
  {
    "id": "Preset_CoffeeHue",
    "label": "CoffeeHue",
    "kind": "Effect::ManualEnhance",
    "params": {
      "brightness": 0.806,
      "contrast": 0.935,
      "saturate": 1.108,
      "hue": -5.7,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": 0.46
    }
  },
  {
    "id": "Preset_ForestLake",
    "label": "ForestLake",
    "kind": "Effect::ManualEnhance",
    "params": {
      "brightness": 0.811,
      "contrast": 1.081,
      "saturate": 1.117,
      "hue": 19.8,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": -0.09
    }
  },
  {
    "id": "Preset_GoldenHour",
    "label": "GoldenHour",
    "kind": "Effect::ManualEnhance",
    "params": {
      "brightness": 1.002,
      "contrast": 0.969,
      "saturate": 1.045,
      "hue": -4.5,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": 0.2
    }
  },
  {
    "id": "Preset_HotSun",
    "label": "HotSun",
    "kind": "Effect::ManualEnhance",
    "params": {
      "brightness": 0.931,
      "contrast": 0.903,
      "saturate": 1.135,
      "hue": 3,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": 0.5
    }
  },
  {
    "id": "Preset_LowExposure",
    "label": "LowExposure",
    "kind": "Effect::ManualEnhance",
    "params": {
      "brightness": 0.625,
      "contrast": 1.026,
      "saturate": 0.865,
      "hue": -0.9,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": 0.01
    }
  },
  {
    "id": "Preset_NaturalTone",
    "label": "NaturalTone",
    "kind": "Effect::ManualEnhance",
    "params": {
      "brightness": 1.005,
      "contrast": 1.077,
      "saturate": 1.045,
      "hue": -3.6,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": -0.04
    }
  },
  {
    "id": "Preset_Peachy",
    "label": "Peachy",
    "kind": "Effect::ManualEnhance",
    "params": {
      "brightness": 0.999,
      "contrast": 0.948,
      "saturate": 1.108,
      "hue": -11.7,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": 0.08
    }
  },
  {
    "id": "Preset_RubyRose",
    "label": "RubyRose",
    "kind": "Effect::ManualEnhance",
    "params": {
      "brightness": 0.993,
      "contrast": 0.894,
      "saturate": 1.108,
      "hue": -19.2,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": 0.03
    }
  },
  {
    "id": "Preset_TenderPastel",
    "label": "TenderPastel",
    "kind": "Effect::ManualEnhance",
    "params": {
      "brightness": 1.108,
      "contrast": 0.947,
      "saturate": 1.36,
      "hue": -5.4,
      "blur": 0,
      "grayscale": 0,
      "sepia": 0,
      "invert": 0,
      "temperature": 0.26
    }
  }
];

export const stockPanZoom: StockPanZoom[] = [
  {
    "id": "pan_down",
    "label": "pan down",
    "interpolation": "Linear",
    "zoomStart": 1.502,
    "zoomEnd": 1.502,
    "panX": 0,
    "panY": -0.247
  },
  {
    "id": "pan_left",
    "label": "pan left",
    "interpolation": "Linear",
    "zoomStart": 1.502,
    "zoomEnd": 1.502,
    "panX": 0.251,
    "panY": 0
  },
  {
    "id": "pan_right",
    "label": "pan right",
    "interpolation": "Linear",
    "zoomStart": 1.502,
    "zoomEnd": 1.502,
    "panX": -0.249,
    "panY": 0
  },
  {
    "id": "pan_up",
    "label": "pan up",
    "interpolation": "Linear",
    "zoomStart": 1.502,
    "zoomEnd": 1.502,
    "panX": 0,
    "panY": 0.251
  },
  {
    "id": "zoom_in",
    "label": "zoom in",
    "interpolation": "Linear",
    "zoomStart": 1,
    "zoomEnd": 2,
    "panX": 0,
    "panY": 0
  },
  {
    "id": "zoom_out",
    "label": "zoom out",
    "interpolation": "Linear",
    "zoomStart": 2,
    "zoomEnd": 1,
    "panX": 0,
    "panY": 0
  }
];

export const stockPip: StockPip[] = [
  {
    "id": "Effect_01_picture_in_picture",
    "label": "01 picture in picture",
    "scale": 0.5,
    "scaleY": 0.5,
    "x": 0.25,
    "y": 0.25
  },
  {
    "id": "Effect_02_logo",
    "label": "02 logo",
    "scale": 0.2,
    "scaleY": 0.2,
    "x": 0.375,
    "y": 0
  },
  {
    "id": "Effect_03_cutaway",
    "label": "03 cutaway",
    "scale": 1,
    "scaleY": 1,
    "x": 0,
    "y": 0
  },
  {
    "id": "Effect_04_side_by_side_left",
    "label": "04 side by side left",
    "scale": 0.5,
    "scaleY": 0.5,
    "x": 0.25,
    "y": 0.25
  },
  {
    "id": "Effect_05_side_by_side_right",
    "label": "05 side by side right",
    "scale": 0.5,
    "scaleY": 0.5,
    "x": 0.25,
    "y": 0.25
  },
  {
    "id": "Effect_06_side_by_side_top",
    "label": "06 side by side top",
    "scale": 0.5,
    "scaleY": 0.5,
    "x": 0.25,
    "y": 0.25
  },
  {
    "id": "Effect_07_side_by_side_bottom",
    "label": "07 side by side bottom",
    "scale": 0.5,
    "scaleY": 0.5,
    "x": 0.25,
    "y": 0.25
  },
  {
    "id": "Effect_08_side_by_side_3x1_left",
    "label": "08 side by side 3x1 left",
    "scale": 0.5,
    "scaleY": 0.5,
    "x": 0.25,
    "y": 0.25
  },
  {
    "id": "Effect_09_side_by_side_3x1_center",
    "label": "09 side by side 3x1 center",
    "scale": 0.5,
    "scaleY": 0.5,
    "x": 0.25,
    "y": 0.25
  },
  {
    "id": "Effect_10_side_by_side_3x1_right",
    "label": "10 side by side 3x1 right",
    "scale": 0.5,
    "scaleY": 0.5,
    "x": 0.25,
    "y": 0.25
  }
];

export const stockAudioEffects: StockAudioEffect[] = [
  {
    "id": "Echo",
    "label": "Echo",
    "group": "effect",
    "className": "Effect::AudioEcho",
    "nodeClass": "Effect::AudioEcho",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioEcho",
        "object_id": 1
      },
      "Effect::AudioFilter": {
        "@meta": {
          "class_name": "Effect::AudioFilter",
          "object_id": 2
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 3
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "Echo",
          "groupId": "2f95ac2d-7ee2-4f3e-8391-9a1ee8674521",
          "id": "2f95ac2d-7ee2-4f3e-8391-9a1ee8674521",
          "intensity": 1,
          "itemUniqueId": "e99cca78-209d-42fa-bbe2-5391f63fb9f1",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 4
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "Echo"
        }
      },
      "echos": [
        {
          "@meta": {
            "class_name": "Effect::AudioEcho::Echo",
            "object_id": 5
          },
          "decay": 0.5,
          "delay": 300
        },
        {
          "@meta": {
            "class_name": "Effect::AudioEcho::Echo",
            "object_id": 6
          },
          "decay": 0.2,
          "delay": 600
        }
      ],
      "gainIn": 1,
      "gainOut": 1
    }
  },
  {
    "id": "Muffle",
    "label": "Muffle",
    "group": "effect",
    "className": "Effect::AudioMuffle",
    "nodeClass": "Effect::AudioMuffle",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioMuffle",
        "object_id": 1
      },
      "Effect::AudioFilter": {
        "@meta": {
          "class_name": "Effect::AudioFilter",
          "object_id": 2
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 3
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "Muffle",
          "groupId": "4e96f14f-3abe-46e7-9600-6b7cba9702c2",
          "id": "4e96f14f-3abe-46e7-9600-6b7cba9702c2",
          "intensity": 1,
          "itemUniqueId": "753625c3-c8fe-4d8c-b21d-5db929d8cb4a",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 4
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "Muffle"
        }
      },
      "dispersion": 3,
      "gainDown": 50,
      "gainUp": 10,
      "mean": 500
    }
  },
  {
    "id": "Effect__AudioOscillation",
    "label": "AudioOscillation",
    "group": "effect",
    "className": "Effect::AudioFlanger",
    "nodeClass": "Effect::AudioFlanger",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioFlanger",
        "object_id": 1
      },
      "Effect::AudioEffect": {
        "@meta": {
          "class_name": "Effect::AudioEffect",
          "object_id": 2
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 3
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "Oscillation",
          "groupId": "4xs5ynjf-bvz3-evjm-wqy4-rxzzjrxfgwzk",
          "id": "4xs5ynjf-bvz3-evjm-wqy4-rxzzjrxfgwzk",
          "intensity": 1,
          "itemUniqueId": "5b4134df-cd30-4763-8d96-fc0ed5ed1245",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 4
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "Oscillation"
        }
      },
      "delay": 30,
      "depth": 10,
      "interpolation": 0,
      "phase": 25,
      "regen": 0,
      "shape": 1,
      "speed": 10
    }
  },
  {
    "id": "Effect__AudioOverload",
    "label": "AudioOverload",
    "group": "effect",
    "className": "Effect::AudioDistortion",
    "nodeClass": "Effect::AudioDistortion",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioDistortion",
        "object_id": 1
      },
      "Effect::AudioEffect": {
        "@meta": {
          "class_name": "Effect::AudioEffect",
          "object_id": 2
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 3
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "Overload",
          "groupId": "ms35vb5f-8pyz-5wt4-3cdj-yvtuyyy29qdf",
          "id": "ms35vb5f-8pyz-5wt4-3cdj-yvtuyyy29qdf",
          "intensity": 0.7,
          "itemUniqueId": "e20095e6-df68-478d-8428-63ed41a6a836",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 4
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "Overload"
        }
      },
      "boost": 0.1,
      "tone": 0.5,
      "type": 0
    }
  },
  {
    "id": "Phone",
    "label": "Phone",
    "group": "effect",
    "className": "Effect::AudioPhone",
    "nodeClass": "Effect::AudioPhone",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioPhone",
        "object_id": 1
      },
      "Effect::AudioFilter": {
        "@meta": {
          "class_name": "Effect::AudioFilter",
          "object_id": 2
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 3
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "Phone",
          "groupId": "75ec87aa-b009-4e27-8b9a-716e5c8eca42",
          "id": "75ec87aa-b009-4e27-8b9a-716e5c8eca42",
          "intensity": 0.67,
          "itemUniqueId": "d903b3bc-8e50-4324-bf7e-dbe71ef7cea6",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 4
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "Phone"
        }
      },
      "gainDown": 75,
      "gainUp": 30,
      "lBound": 200,
      "rBound": 8000
    }
  },
  {
    "id": "PitchHigh",
    "label": "PitchHigh",
    "group": "effect",
    "className": "Effect::AudioPitch",
    "nodeClass": "Effect::AudioPitch",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioPitch",
        "object_id": 1
      },
      "Effect::AudioFilter": {
        "@meta": {
          "class_name": "Effect::AudioFilter",
          "object_id": 2
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 3
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "PitchHigh",
          "groupId": "6282435b-aef6-47fd-a234-9eb95a83ea58",
          "id": "6282435b-aef6-47fd-a234-9eb95a83ea58",
          "intensity": 0.5,
          "itemUniqueId": "e9247aa6-9b64-4a8b-89b0-8be0b3937f87",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 4
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "PitchHigh"
        }
      },
      "pitch": 0.6
    }
  },
  {
    "id": "PitchLow",
    "label": "PitchLow",
    "group": "effect",
    "className": "Effect::AudioPitch",
    "nodeClass": "Effect::AudioPitch",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioPitch",
        "object_id": 1
      },
      "Effect::AudioFilter": {
        "@meta": {
          "class_name": "Effect::AudioFilter",
          "object_id": 2
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 3
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "PitchLow",
          "groupId": "6282435b-aef6-47fd-a234-9eb95a83ea58",
          "id": "6282435b-aef6-47fd-a234-9eb95a83ea58",
          "intensity": 0.5,
          "itemUniqueId": "e16e4913-a2f3-4f42-9d74-2e5da7f05bf0",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 4
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "PitchLow"
        }
      },
      "pitch": 1.5
    }
  },
  {
    "id": "PitchVeryHigh",
    "label": "PitchVeryHigh",
    "group": "effect",
    "className": "Effect::AudioPitch",
    "nodeClass": "Effect::AudioPitch",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioPitch",
        "object_id": 1
      },
      "Effect::AudioFilter": {
        "@meta": {
          "class_name": "Effect::AudioFilter",
          "object_id": 2
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 3
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "PitchVeryHigh",
          "groupId": "6282435b-aef6-47fd-a234-9eb95a83ea58",
          "id": "6282435b-aef6-47fd-a234-9eb95a83ea58",
          "intensity": 0.8,
          "itemUniqueId": "5e26e529-d7ee-4809-83c3-28c8347eadb5",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 4
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "PitchVeryHigh"
        }
      },
      "pitch": 0.6
    }
  },
  {
    "id": "PitchVeryLow",
    "label": "PitchVeryLow",
    "group": "effect",
    "className": "Effect::AudioPitch",
    "nodeClass": "Effect::AudioPitch",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioPitch",
        "object_id": 1
      },
      "Effect::AudioFilter": {
        "@meta": {
          "class_name": "Effect::AudioFilter",
          "object_id": 2
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 3
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "PitchVeryLow",
          "groupId": "6282435b-aef6-47fd-a234-9eb95a83ea58",
          "id": "6282435b-aef6-47fd-a234-9eb95a83ea58",
          "intensity": 1,
          "itemUniqueId": "ed654ba2-146c-4185-940e-b7e7ab4ee728",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 4
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "PitchVeryLow"
        }
      },
      "pitch": 1.5
    }
  },
  {
    "id": "Radio",
    "label": "Radio",
    "group": "effect",
    "className": "Effect::AudioRadio",
    "nodeClass": "Effect::AudioRadio",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioRadio",
        "object_id": 1
      },
      "Effect::AudioFilter": {
        "@meta": {
          "class_name": "Effect::AudioFilter",
          "object_id": 2
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 3
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "Radio",
          "groupId": "4c412762-56f7-4703-a840-ea2ccf5f7321",
          "id": "4c412762-56f7-4703-a840-ea2ccf5f7321",
          "intensity": 1,
          "itemUniqueId": "f03b95f5-2ac4-43ef-a0fa-b7be8ca88dae",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 4
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "Radio"
        }
      },
      "crackleP": 8,
      "gainDown": 50,
      "gainUp": 20,
      "lBound": 200,
      "noise": 0.05,
      "rBound": 8000
    }
  },
  {
    "id": "Robot",
    "label": "Robot",
    "group": "effect",
    "className": "Effect::AudioRobot",
    "nodeClass": "Effect::AudioRobot",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioRobot",
        "object_id": 1
      },
      "Effect::AudioFilter": {
        "@meta": {
          "class_name": "Effect::AudioFilter",
          "object_id": 2
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 3
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "Robot",
          "groupId": "a10632bf-c9ad-4399-ab6b-cf2fd39b93f6",
          "id": "a10632bf-c9ad-4399-ab6b-cf2fd39b93f6",
          "intensity": 1,
          "itemUniqueId": "9f0e6fc2-8f55-440d-b831-affa7ff8be13",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 4
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "Robot"
        }
      },
      "level": 1,
      "pitch": 1.1
    }
  },
  {
    "id": "Effect__AudioVibrato",
    "label": "AudioVibrato",
    "group": "effect",
    "className": "Effect::AudioVibrato",
    "nodeClass": "Effect::AudioVibrato",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioVibrato",
        "object_id": 1
      },
      "Effect::AudioEffect": {
        "@meta": {
          "class_name": "Effect::AudioEffect",
          "object_id": 2
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 3
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "Vibrato",
          "groupId": "5hv7ahhu-kmfe-rbyp-5sy2-v6rvzgb6pvg8",
          "id": "5hv7ahhu-kmfe-rbyp-5sy2-v6rvzgb6pvg8",
          "intensity": 0.8,
          "itemUniqueId": "d32c2a90-1038-41f9-ab9f-73a6eb9f6a4b",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 4
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "Vibrato"
        }
      },
      "frequencyHz": 15
    }
  },
  {
    "id": "Effect__AutoNoiseRemovalHigh",
    "label": "AutoNoiseRemovalHigh",
    "group": "enhance",
    "className": "Effect::AudioEnhance",
    "nodeClass": "Effect::AudioNoiseSuppress",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioNoiseSuppress",
        "object_id": 6
      },
      "Effect::AudioFilter": {
        "@meta": {
          "class_name": "Effect::AudioFilter",
          "object_id": 7
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 8
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "effect_noisesuppress",
          "groupId": "4b8b30d0-f345-48c1-b8d3-acca60bf2083",
          "id": "08fa3c82-5bea-4629-b7d5-d62b5bc3f7e5",
          "intensity": 1,
          "itemUniqueId": "",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 9
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "effect_noisesuppress"
        }
      },
      "levelPercent": 70
    }
  },
  {
    "id": "Effect__AutoNoiseRemovalLow",
    "label": "AutoNoiseRemovalLow",
    "group": "enhance",
    "className": "Effect::AudioEnhance",
    "nodeClass": "Effect::AudioNoiseSuppress",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioNoiseSuppress",
        "object_id": 6
      },
      "Effect::AudioFilter": {
        "@meta": {
          "class_name": "Effect::AudioFilter",
          "object_id": 7
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 8
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "effect_noisesuppress",
          "groupId": "4b8b30d0-f345-48c1-b8d3-acca60bf2083",
          "id": "08fa3c82-5bea-4629-b7d5-d62b5bc3f7e5",
          "intensity": 1,
          "itemUniqueId": "",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 9
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "effect_noisesuppress"
        }
      },
      "levelPercent": 20
    }
  },
  {
    "id": "Effect__VoiceEnhancement",
    "label": "VoiceEnhancement",
    "group": "enhance",
    "className": "Effect::AudioEnhance",
    "nodeClass": "Effect::AudioNoiseSuppress",
    "params": {
      "@meta": {
        "class_name": "Effect::AudioNoiseSuppress",
        "object_id": 6
      },
      "Effect::AudioFilter": {
        "@meta": {
          "class_name": "Effect::AudioFilter",
          "object_id": 7
        },
        "Effect::Object": {
          "@meta": {
            "class_name": "Effect::Object",
            "object_id": 8
          },
          "auxResource": {
            "element_0": "",
            "element_1": 0
          },
          "bypass": false,
          "description": "effect_noisesuppress",
          "groupId": "4b8b30d0-f345-48c1-b8d3-acca60bf2083",
          "id": "08fa3c82-5bea-4629-b7d5-d62b5bc3f7e5",
          "intensity": 1,
          "itemUniqueId": "",
          "processedRange": {
            "@meta": {
              "class_name": "Types::Range",
              "object_id": 9
            },
            "from": 0,
            "to": -1
          },
          "resourcePath": "",
          "tag": "effect_noisesuppress"
        }
      },
      "levelPercent": 50
    }
  }
];

export const stockTitles: StockTitle[] = [
  {
    "id": "themes-01__Family",
    "label": "Family3",
    "description": "For calm family videos Upbeat music",
    "category": "calm",
    "downloadable": true
  },
  {
    "id": "themes-02__Memories",
    "label": "Memories3",
    "description": "For calm videos reminiscent of old days Instrumental music",
    "category": "calm",
    "downloadable": true
  },
  {
    "id": "themes-03__Travel",
    "label": "Travel3",
    "description": "For dynamic travel videos Uplifting music",
    "category": "energetic",
    "downloadable": true
  },
  {
    "id": "themes-04__Love",
    "label": "Love3",
    "description": "For love videos Love music",
    "category": "romantic",
    "downloadable": true
  },
  {
    "id": "themes-05__Birthday",
    "label": "Birthday3",
    "description": "For birthday videos Birthday music",
    "category": "upbeat",
    "downloadable": true
  },
  {
    "id": "themes-06__Action",
    "label": "Action3",
    "description": "For action videos Action music",
    "category": "energetic",
    "downloadable": true
  },
  {
    "id": "themes-07__Children",
    "label": "Children3",
    "description": "For videos of precious moments in your kids’ lives Children music",
    "category": "upbeat",
    "downloadable": true
  },
  {
    "id": "themes-08__Holidays",
    "label": "Holidays3",
    "description": "For videos of your parties and holiday activities Holidays music",
    "category": "upbeat",
    "downloadable": true
  },
  {
    "id": "themes-09__Nature",
    "label": "Nature3",
    "description": "For videos of scenic landscapes Nature music",
    "category": "calm",
    "downloadable": true
  },
  {
    "id": "themes-10__Summer",
    "label": "Summer3",
    "description": "For videos of your breezy trips to the ocean Hawaiian music",
    "category": "calm",
    "downloadable": true
  },
  {
    "id": "intros-Intro_New",
    "label": "#TOP_ITEM#New intro",
    "description": "#TOP_ITEM#New intro",
    "category": "category_my_intros",
    "downloadable": false
  },
  {
    "id": "subtitles-Subtitle",
    "label": "#TOP_ITEM# No preset",
    "description": "#TOP_ITEM# No preset",
    "category": "subtitles",
    "downloadable": false
  },
  {
    "id": "subtitles-Subtitle_vertical",
    "label": "#TOP_ITEM# No preset vertical",
    "description": "#TOP_ITEM# No preset",
    "category": "subtitles",
    "downloadable": false
  },
  {
    "id": "wizardBackgrounds-WBackground_1",
    "label": "",
    "description": "",
    "category": "backgrounds",
    "downloadable": true
  },
  {
    "id": "wizardBackgrounds-WBackground_2",
    "label": "",
    "description": "",
    "category": "backgrounds",
    "downloadable": true
  },
  {
    "id": "wizardBackgrounds-WBackground_3",
    "label": "",
    "description": "",
    "category": "backgrounds",
    "downloadable": true
  },
  {
    "id": "wizardBackgrounds-WBackground_4",
    "label": "",
    "description": "",
    "category": "backgrounds",
    "downloadable": true
  },
  {
    "id": "wizardBackgrounds-WBackground_5",
    "label": "",
    "description": "",
    "category": "backgrounds",
    "downloadable": true
  },
  {
    "id": "wizardBackgrounds-WBackground_6",
    "label": "",
    "description": "",
    "category": "backgrounds",
    "downloadable": true
  },
  {
    "id": "wizardBackgrounds-WBackground_7",
    "label": "",
    "description": "",
    "category": "backgrounds",
    "downloadable": true
  }
];

export const stockSounds: StockSound[] = [
  {
    "id": "clickdown",
    "file": "clickdown.wav"
  },
  {
    "id": "clickup",
    "file": "clickup.wav"
  }
];
