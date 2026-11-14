# Shared Game Contract v0.1

Normative contract for every game, bot, server and screen in this repo. Do not change it without a CHANGE_REQUEST.md and review.


This entire section is identical in both language editions and is the proposed phase-0 contract for the engine-core design. Names below are design signatures, not implementation code. JSON below is declarative schema only. No implementation, prototype, or executable game fragment is included.

### Functions and ownership / 함수와 책임

| Design signature | Contract |
|---|---|
| describe() → GameDescriptor | gameId, supported players, realtime/turn/party mode, action catalog and input hints; no renderer dependency |
| initial(config: MatchConfig, data: GameData) → State | Pure initial state; includes PRNG state, tick=0, pending turn and complete future-affecting simulation data |
| observe(state: State, playerId: string) → Observation | Player-visible data only; bots, controllers and nonprivileged displays never receive hidden cards or private RNG state |
| legalActions(observation: Observation) → ActionSpec[] | Stable action IDs and bounded parameter domains; server independently checks legality against authoritative state |
| step(state: State, frame: InputFrame, data: GameData) → StepResult | Exactly one logical tick; returns new state, ordered public/private events, terminal outcome and additive statistics; no clock, I/O or network access |
| outcome(state: State) → Outcome | running, win or draw; winners may contain multiple player IDs; elimination is separate from match termination |
| statistics(state: State) → Statistics | Per-player/action opportunities, uses, damage, duration and result; unavailable metrics explicitly absent |
| hash(state: State) → string | Hash of canonical full simulation state; server/runner only when private state exists |

Adapters implement these functions. Runner, room service, launcher and controller shell consume this contract; game-specific renderer consumes Observation, not State. Human and bot inputs share exactly ActionInput. Generic controls are generated from action domains (buttons, bounded axes, selectable targets); custom layout hints cannot alter simulation rules.

### Time, input and determinism / 시간·입력·결정성

One step always increments tick by one. Realtime and party run at 60 logical ticks/s; turn games advance only on an accepted turn action or an authoritative timeout frame. Wall-clock waiting never enters state. TurnId increments only when the game resolves its active turn; a rejected input does not advance a turn. Simultaneous turn games would collect all active-player choices into one frame, but phase 0 supports sequential turns only.

Authority builds a complete frame, sorted by playerId then seq, with at most one action per player per tick. The phase-0 action envelope contains bounded axes and a button bitmask, or a card/target choice as defined by the catalog. Missing realtime input becomes neutral; late input is rejected, never retroactively applied. A turn timeout becomes a logged system.timeout input; bots use identical action envelopes but cannot forge system inputs. Deadlines are room policy; only resulting frames are replayed. Server validates seat, turn, tick window, monotonic sequence, action ID and parameter limits. Duplicate sequence returns its previous receipt without applying twice.

Positions, damage and timers are bounded safe integers (position unit 1/1000 world unit). Multiplication intermediates must remain within 2^53−1, with explicit integer division rounding toward zero. Stable entity iteration by ID; no locale sorting, host clock, ambient random, floating-point physics, or unordered map iteration. Proposed PRNG algorithm ID: xorshift32-v1 with unsigned 32-bit operations; reject seed zero. PRNG state is serialized. Algorithm changes require simVersion change. Cosmetic randomness is isolated from simulation.

Canonical JSON: recursively lexicographically sort object keys by Unicode code point, retain array order, UTF-8, no insignificant whitespace, integer numbers only, no undefined/NaN/Infinity/negative zero. Hash algorithm: SHA-256, lowercase hexadecimal. Hash includes tick, PRNG, pending inputs/effects, cooldowns and terminal state; excludes display, timestamps and transport fields. dataHash covers immutable game data and tuning. Snapshot compatibility requires exact contractVersion, gameId, simVersion, schemaVersion and dataHash. No automatic cross-version replay.

### JSON Schema 2020-12 / 데이터 스키마

Schema bundle below defines wire shapes. Every simulation schema referenced through State/Observation/action params must also be registered by gameId and schemaVersion, with closed properties and bounds; unregistered schemas are rejected. Cross-field checks below are mandatory in addition to JSON Schema validation.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:balance-forge:game-contract:0.1",
  "title": "Shared Game Contract v0.1",
  "$defs": {
    "ActionInput": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "playerId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "seq": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "tick": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "turnId": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "actionId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "params": {
          "type": "object",
          "maxProperties": 16
        }
      },
      "required": [
        "playerId",
        "seq",
        "tick",
        "turnId",
        "actionId",
        "params"
      ]
    },
    "InputFrame": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "tick": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "actions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ActionInput"
          }
        },
        "systemInputs": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "kind": {
                "enum": [
                  "system.timeout"
                ]
              },
              "playerId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "turnId": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              }
            },
            "required": [
              "kind",
              "playerId",
              "turnId"
            ]
          }
        }
      },
      "required": [
        "tick",
        "actions",
        "systemInputs"
      ]
    },
    "MatchConfig": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "contractVersion": {
          "const": "0.1"
        },
        "schemaVersion": {
          "const": 1
        },
        "gameId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "simVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "dataHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "seed": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4294967295
        },
        "players": {
          "type": "array",
          "minItems": 1,
          "maxItems": 4,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          }
        },
        "mode": {
          "enum": [
            "realtime",
            "turn",
            "party"
          ]
        },
        "maxTicks": {
          "type": "integer",
          "minimum": 1,
          "maximum": 2147483647
        }
      },
      "required": [
        "contractVersion",
        "schemaVersion",
        "gameId",
        "simVersion",
        "dataHash",
        "seed",
        "players",
        "mode",
        "maxTicks"
      ]
    },
    "State": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "tick": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "rng": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4294967295
        },
        "turnId": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "payload": {
          "type": "object"
        }
      },
      "required": [
        "tick",
        "rng",
        "turnId",
        "payload"
      ]
    },
    "Observation": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "tick": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "viewerId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "payload": {
          "type": "object"
        }
      },
      "required": [
        "tick",
        "viewerId",
        "payload"
      ]
    },
    "Outcome": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "status": {
          "enum": [
            "running",
            "win",
            "draw"
          ]
        },
        "winners": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "uniqueItems": true
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      },
      "required": [
        "status",
        "winners",
        "reason"
      ]
    },
    "ActionSpec": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "actionId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "labelKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "control": {
          "enum": [
            "button",
            "axes",
            "choice"
          ]
        },
        "paramsSchema": {
          "type": "object"
        }
      },
      "required": [
        "actionId",
        "labelKey",
        "control",
        "paramsSchema"
      ]
    },
    "GameDescriptor": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "gameId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "titleKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "mode": {
          "enum": [
            "realtime",
            "turn",
            "party"
          ]
        },
        "minPlayers": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4
        },
        "maxPlayers": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4
        },
        "actions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ActionSpec"
          }
        }
      },
      "required": [
        "gameId",
        "titleKey",
        "mode",
        "minPlayers",
        "maxPlayers",
        "actions"
      ]
    },
    "Statistics": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "players": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "playerId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "wins": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              },
              "draws": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              },
              "damage": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              },
              "actions": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "actionId": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 128
                    },
                    "opportunities": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 2147483647
                    },
                    "uses": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 2147483647
                    }
                  },
                  "required": [
                    "actionId",
                    "opportunities",
                    "uses"
                  ]
                }
              }
            },
            "required": [
              "playerId",
              "wins",
              "draws",
              "damage",
              "actions"
            ]
          }
        },
        "durationTicks": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        }
      },
      "required": [
        "players",
        "durationTicks"
      ]
    },
    "StepResult": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "state": {
          "$ref": "#/$defs/State"
        },
        "events": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "eventId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "audience": {
                "type": "array",
                "items": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                }
              },
              "kind": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "payload": {
                "type": "object"
              }
            },
            "required": [
              "eventId",
              "audience",
              "kind",
              "payload"
            ]
          }
        },
        "outcome": {
          "$ref": "#/$defs/Outcome"
        },
        "statisticsDelta": {
          "$ref": "#/$defs/Statistics"
        }
      },
      "required": [
        "state",
        "events",
        "outcome",
        "statisticsDelta"
      ]
    },
    "Snapshot": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "config": {
          "$ref": "#/$defs/MatchConfig"
        },
        "tick": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "state": {
          "$ref": "#/$defs/State"
        },
        "stateHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        }
      },
      "required": [
        "config",
        "tick",
        "state",
        "stateHash"
      ]
    },
    "Effect": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "operator": {
          "enum": [
            "damage",
            "shield",
            "knockback",
            "cooldown"
          ]
        },
        "amount": {
          "type": "integer",
          "minimum": -1000000,
          "maximum": 1000000
        },
        "durationTicks": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        }
      },
      "required": [
        "operator",
        "amount",
        "durationTicks"
      ]
    },
    "Move": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "nameKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "archetype": {
          "enum": [
            "melee",
            "projectile",
            "guard"
          ]
        },
        "weightTier": {
          "type": "integer",
          "minimum": 0,
          "maximum": 3
        },
        "power": {
          "type": "integer",
          "minimum": 0,
          "maximum": 10000
        },
        "effects": {
          "type": "array",
          "maxItems": 8,
          "items": {
            "$ref": "#/$defs/Effect"
          }
        },
        "authorKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "licenseKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      },
      "required": [
        "id",
        "nameKey",
        "archetype",
        "weightTier",
        "power",
        "effects",
        "authorKey",
        "licenseKey"
      ]
    },
    "Character": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "nameKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "health": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000000
        },
        "speed": {
          "type": "integer",
          "minimum": 0,
          "maximum": 10000
        },
        "moveIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 8,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          }
        },
        "authorKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "licenseKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      },
      "required": [
        "id",
        "nameKey",
        "health",
        "speed",
        "moveIds",
        "authorKey",
        "licenseKey"
      ]
    },
    "GameData": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "v": {
          "const": 1
        },
        "gameId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "characters": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Character"
          }
        },
        "moves": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Move"
          }
        },
        "weightTiers": {
          "type": "array",
          "minItems": 4,
          "maxItems": 4,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "startupTicks": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              },
              "recoveryTicks": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              },
              "cooldownTicks": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              },
              "stunTicks": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              },
              "knockback": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              },
              "hitStopTicks": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              }
            },
            "required": [
              "startupTicks",
              "recoveryTicks",
              "cooldownTicks",
              "stunTicks",
              "knockback",
              "hitStopTicks"
            ]
          }
        },
        "tuning": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "damageScalePermille": {
              "type": "integer",
              "minimum": 100,
              "maximum": 3000
            }
          },
          "required": [
            "damageScalePermille"
          ]
        },
        "gameRules": {
          "type": "object"
        },
        "provenance": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "authorKey": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "licenseKey": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "source": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "noticeKey": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              }
            },
            "required": [
              "authorKey",
              "licenseKey",
              "source",
              "noticeKey"
            ]
          }
        }
      },
      "required": [
        "v",
        "gameId",
        "characters",
        "moves",
        "weightTiers",
        "tuning",
        "gameRules",
        "provenance"
      ]
    },
    "MatchResult": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "matchId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "config": {
          "$ref": "#/$defs/MatchConfig"
        },
        "outcome": {
          "$ref": "#/$defs/Outcome"
        },
        "statistics": {
          "$ref": "#/$defs/Statistics"
        },
        "finalStateHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "valid": {
          "type": "boolean"
        },
        "errorCode": {
          "type": "string",
          "maxLength": 128
        }
      },
      "required": [
        "matchId",
        "config",
        "outcome",
        "statistics",
        "finalStateHash",
        "valid",
        "errorCode"
      ]
    },
    "Report": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "reportId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "gameId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "simVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "dataHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "botPolicyVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "seedSetId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "validMatches": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "invalidMatches": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "draws": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        },
        "rows": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "dimension": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "wins": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              },
              "games": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              },
              "winRate": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "ci95": {
                "type": "array",
                "minItems": 2,
                "maxItems": 2,
                "items": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1
                }
              },
              "uses": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              },
              "opportunities": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483647
              },
              "outlier": {
                "type": "boolean"
              }
            },
            "required": [
              "dimension",
              "wins",
              "games",
              "winRate",
              "ci95",
              "uses",
              "opportunities",
              "outlier"
            ]
          }
        }
      },
      "required": [
        "reportId",
        "gameId",
        "simVersion",
        "dataHash",
        "botPolicyVersion",
        "seedSetId",
        "validMatches",
        "invalidMatches",
        "draws",
        "rows"
      ]
    },
    "PatchProposal": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "baseDataHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "replacements": {
          "type": "array",
          "minItems": 1,
          "maxItems": 8,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "path": {
                "type": "string",
                "pattern": "^/(tuning/damageScalePermille|moves/[0-9]+/power)$"
              },
              "value": {
                "type": "integer",
                "minimum": 0,
                "maximum": 10000
              }
            },
            "required": [
              "path",
              "value"
            ]
          }
        },
        "rationale": {
          "type": "string",
          "maxLength": 2000
        }
      },
      "required": [
        "baseDataHash",
        "replacements",
        "rationale"
      ]
    }
  },
  "oneOf": [
    {
      "$ref": "#/$defs/MatchConfig"
    },
    {
      "$ref": "#/$defs/InputFrame"
    },
    {
      "$ref": "#/$defs/Snapshot"
    },
    {
      "$ref": "#/$defs/GameData"
    },
    {
      "$ref": "#/$defs/MatchResult"
    },
    {
      "$ref": "#/$defs/Report"
    },
    {
      "$ref": "#/$defs/PatchProposal"
    }
  ]
}
```

Semantic constraints: player IDs are unique; winners reference seats; InputFrame.tick equals State.tick+1; ActionInput.tick matches frame tick; turnId matches active turn. Content IDs are unique, all references resolve, every authorKey/licenseKey resolves in the provenance registry. State payload must include all future-affecting data and validate against its game-specific schema. Action params validate against ActionSpec.paramsSchema and server-side legality. Snapshot.state.tick equals Snapshot.tick; stateHash is recomputed after restore. Replay records the actual accepted frame stream, not raw controller arrival order. MatchConfig pins one immutable dataHash for the entire match.

Weight tiers define startup, recovery, cooldown, stun, knockback and hit-stop in integer ticks. Species exceptions belong in character data, not tuning ID checks. Phase 0 uses 3 original archetypes (melee, projectile, guard), 4 weight tiers and 4 effect operators (damage, shield, knockback, cooldown); larger archetype/operator catalogs are later engine work. Operators execute only registered deterministic behavior; content cannot contain scripts. Turn/card and party actions share ActionInput while their params and rules remain game-specific.

### Transport and errors / 통신·오류

Envelope: protocolVersion, type, roomId, sessionId, requestId, seq, epoch, payload. HTTPS handles catalog/create/join; persistent WebSocket carries authoritative play and snapshots. Proposed endpoints: GET /v1/games, POST /v1/rooms, POST /v1/rooms/{id}/join, GET /v1/reports/{id}; join response contains scoped short-lived seat token, protocolVersion, simVersion and dataHash. Tokens are never placed in reports or replay logs.

| Direction | Message | Required payload and behavior |
|---|---|---|
| Display → server | room.create, game.select, match.start | gameId/dataHash, requested seats; only host capability can start |
| Controller → server | room.join, input.submit, reconnect | joinCode/seat token; ActionInput; lastAck respectively |
| Server → all authorized clients | room.status, match.started, input.ack, match.ended | seats and phase; MatchConfig; seq/status/acceptedTick; MatchResult |
| Server → display/controller | state.view, actions.available | Observation + tick + epoch + viewHash; legal action domains for that seat |
| Display ↔ server ↔ controller | rtc.offer, rtc.answer, rtc.ice, transport.ready | Signaling only, bounded payloads; never authority changes |
| Server ↔ old/new display | handoff.prepare, handoff.ready, handoff.commit, handoff.abort | transferId, target display, epoch, barrier tick, viewHash and acknowledged cursor |
| Client ↔ server | ping, pong, error | transport health; error code, requestId, retryable flag |

WebRTC is optional after the WebSocket path works: ordered reliable data channel relays inputs to the display, which forwards them unchanged to server; acknowledgments remain server-issued. A 1s missing acknowledgment switches controller directly to WebSocket with the same sequence IDs. Phase 0 does not promise WebRTC latency benefits or deploy a TURN service. WebSocket is the default and the fallback; no peer becomes simulation authority.

Handoff sequence: target display joins read-only → server allocates transferId/new epoch → server captures authoritative Snapshot at barrier tick B and derives seat-safe Observation → target loads matching data and renders Observation at B → target acknowledges viewHash and cursor B → server streams catch-up views to current tick → server atomically commits display lease/epoch → old display becomes spectator. Server continues simulation throughout; input tokens stay with controller seats. Private State snapshot stays server-side. A trusted headless runner may import full Snapshot; public displays never do. Timeout after 5s or hash/version failure aborts transfer; old display remains active. Retried transfer IDs are idempotent; stale epochs cannot control display ownership. Server restart terminates phase-0 live rooms; replay and reports survive only if exported.

Errors: INVALID_SCHEMA, ILLEGAL_ACTION, LATE_INPUT, STALE_TURN, VERSION_MISMATCH, HASH_MISMATCH, RATE_LIMITED, ROOM_FULL, AUTH_EXPIRED, TRANSPORT_UNAVAILABLE, PATCH_REJECTED. Invalid inputs never mutate state; runner errors abort that match and mark it invalid, not a draw. Hash mismatch pauses competitive verification and requests a fresh authorized view; never silently changes results. Maximum envelope 64 KiB, maximum snapshot 1 MiB, 120 input submissions/s/seat, 4 seats/room; oversized content is rejected before allocation. JSON nesting max 32. Parameters and limits are proposed design decisions, not measured capability.

### Replay, patch and analysis / 리플레이·패치·분석

Replay header: contractVersion, schemaVersion, gameId, simVersion, dataHash, seed, players, config, bot policy IDs/versions; body: accepted InputFrame stream and periodic state hashes. Observation views cannot replace an authoritative replay. No raw network timing, personal information or tokens in exports.

Analysis groups by gameId/simVersion/dataHash, botPolicyVersion, seed set, matchup and seat. Report win rate with draw count, sample size and 95% Wilson interval; action use rate = uses/opportunities (zero opportunities → unavailable), not uses divided by all matches. Outlier flags are descriptive candidates, not proof of human balance. Seat-swapped paired seeds and fixed holdout seeds prevent cherry-picking; invalid/timeout matches are separately counted.

LLM receives aggregate report and allowlisted numeric tuning paths only. Proposal is data, never executable text: immutable baseDataHash + bounded replacements + rationale. Server validates paths, types, ranges, at most 8 replacements and no identity/license/schema/operator changes. Candidate becomes a new dataHash; existing matches stay pinned. Deterministic tests and matched-seed reruns must pass before human promotion. Accept only when target imbalance distance to 50% improves on holdout with uncertainty shown, no newly extreme matchup above 65% after at least 200 valid paired matches per affected matchup, and invalid-match rate does not increase. Otherwise label inconclusive/rejected; human acceptance is still required. These are demo gates, not production balance guarantees. No LLM/network call is made during this design task.

