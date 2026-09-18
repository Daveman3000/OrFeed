# Volume Bands Step 4 lineage breadth (exploratory)

Source: `policies/exploratory/volume-bands-step4-frozen-anchors-v001.json`, exact-byte SHA-256 `08581b3f083166e7ca1542622c19f85cc91b1aead632c679765425f243b3ed4f`. This is a descriptive rendering of the seven frozen terminal branches, not new qualification, SR/FR/RR evidence, or an adjudication rule. The shared P1 ancestry below must not be counted as independent basins.

| Terminal branch | Family / time filter | P1 ancestor cells | Supported rungs | Terminal class / anchor cells | Anchor ÷ P1 | Recorded split rungs | Terminal status |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `VB-b0bc1ae3ceb1d497` | Inverse Distance / `1400-1500` | 71,001 | 16 | P16 / 48 | 0.0676% | P14, P16 | Natural; exact reason unrecorded |
| `VB-b81107d62901368b` | Inverse Distance / `1400-1500` | 71,001 | 14 | P14 / 32 | 0.0451% | P14 | Natural; exact reason unrecorded |
| `VB-c8f1c209be790205` | Inverse Distance / `1400-1500` | 71,001 | 16 | P16 / 60 | 0.0845% | P14, P16 | Natural; exact reason unrecorded |
| `VB-f85d84baad1b100e` | Inverse Distance / `1400-1500` | 71,001 | 14 | P14 / 48 | 0.0676% | P14 | Natural; exact reason unrecorded |
| `VB-f65664cf610dac78` | Inverse Distance / `None` | 72,071 | 13 | P13 / 80 | 0.1110% | none recorded | Natural; exact reason unrecorded |
| `VB-98bb2a5ef2e2b20c` | Exponential / `1400-1500` | 57,662 | 13 | P13 / 46 | 0.0798% | none recorded | Natural; exact reason unrecorded |
| `VB-a5162befb570e3f6` | Exponential / `None` | 54,847 | 10 | P10 / 148 | 0.2698% | none recorded | Natural; exact reason unrecorded |

## Supported cells at each rung

Counts refer to the supported ancestor on *that branch*, not all passing cells in its context. The four `1400-1500` Inverse Distance branches share P1–P13 ancestry.

| Branch | P1 → terminal supported-cell counts |
| --- | --- |
| `VB-b0bc1ae3ceb1d497` | 71,001 → 65,153 → 55,865 → 45,052 → 34,233 → 25,079 → 18,068 → 12,716 → 8,835 → 6,097 → 4,004 → 2,479 → 1,502 → 719 → 357 → 48 |
| `VB-b81107d62901368b` | 71,001 → 65,153 → 55,865 → 45,052 → 34,233 → 25,079 → 18,068 → 12,716 → 8,835 → 6,097 → 4,004 → 2,479 → 1,502 → 32 |
| `VB-c8f1c209be790205` | 71,001 → 65,153 → 55,865 → 45,052 → 34,233 → 25,079 → 18,068 → 12,716 → 8,835 → 6,097 → 4,004 → 2,479 → 1,502 → 719 → 357 → 60 |
| `VB-f85d84baad1b100e` | 71,001 → 65,153 → 55,865 → 45,052 → 34,233 → 25,079 → 18,068 → 12,716 → 8,835 → 6,097 → 4,004 → 2,479 → 1,502 → 48 |
| `VB-f65664cf610dac78` | 72,071 → 62,316 → 49,052 → 35,126 → 23,969 → 15,685 → 10,138 → 6,243 → 3,616 → 1,829 → 1,021 → 427 → 80 |
| `VB-98bb2a5ef2e2b20c` | 57,662 → 43,263 → 30,839 → 20,183 → 12,425 → 7,186 → 3,998 → 2,188 → 1,203 → 659 → 358 → 180 → 46 |
| `VB-a5162befb570e3f6` | 54,847 → 38,956 → 24,599 → 13,876 → 7,249 → 3,586 → 1,668 → 844 → 376 → 148 |

## Recorded branch formation

| Split | Parent at preceding rung | All recorded supported child sizes | Collective supported children | Terminal branch's child size |
| --- | ---: | --- | ---: | --- |
| P14, Inverse Distance / `1400-1500` | P13: 1,502 | 719, 48, 32 | 799 | `VB-b0…` 719; `VB-b811…` 32; `VB-c8…` 719; `VB-f85…` 48 |
| P16, 719-cell P14 branch | P15: 357 | 60, 48 | 108 | `VB-b0…` 48; `VB-c8…` 60 |

The 719-cell P14 child is shared ancestry for two terminal branches and is counted **once** in the P14 collective total. Parent-to-one-child shrinkage is therefore not pure performance collapse. The frozen artifact does not preserve all unsupported/residual cells at a transition, nor a per-branch distinction between extinction, fragmentation/support loss, or another natural termination cause. No branch reached the P20 cap. `NATURAL_TERMINAL` is the only recorded terminal type for these seven; the finer cause is **unrecorded**, not inferred.

Lineage breadth describes performance-qualified ancestry only. It does not establish broad local support around the terminal core or characterize its boundary. Those are separate questions for the already-frozen anchor SR/FR/RR evidence. No predecessor memberships or new robustness calculations were generated for this table.
