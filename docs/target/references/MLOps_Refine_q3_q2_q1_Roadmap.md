# Codex Task — Tinh chỉnh đề cương NCKH và xây roadmap Q3 → Q2 → Q1

## Mục tiêu

Hãy chỉnh sửa **bản đề cương nghiên cứu hiện tại** dựa trên các đề xuất đã thống nhất trong cuộc hội thoại.

Mục tiêu không phải mở rộng thêm MLOps platform, mà làm cho đề cương có:

1. Scientific scope rõ và đủ hẹp để hoàn thiện một baseline/paper Q3 chắc chắn.
2. Một lộ trình phát triển có thể nâng cấp dần lên Q2.
3. Một “stretch scope” để đánh giá khả năng tiến tới Q1 nếu kết quả thực nghiệm đủ mạnh.
4. Ranh giới rất rõ giữa:
   - **Platform engineering**
   - **Q3 research core**
   - **Q2 research extension**
   - **Q1 stretch / high-risk research**

Không được sửa theo hướng làm đề tài thành một hệ thống quá lớn mà thiếu chiều sâu khoa học.

---

# PART A — Năm điểm cần sửa/bổ sung bắt buộc

## 1. Nâng Diagnosis Engine từ rule-based decision tree thành multi-evidence diagnosis

Đề cương hiện tại có logic dạng:

```text
IF condition A + B
→ Cause C
→ Action D
```

Giữ rule-based logic như **baseline/prototype**, nhưng không để nó là scientific method duy nhất.

Đề xuất cấu trúc:

```text
Production Evidence E
        ↓
Evidence Extraction
        ↓
Multi-Evidence Diagnosis
        ↓
P(Cause | E)
        ↓
Primary Cause
+ Secondary Cause(s)
+ Severity
+ Confidence
        ↓
Risk-Aware Strategy Selector
```

Formalize ở mức vừa phải:

\[
P(C_i \mid E) = f(E_1,E_2,\ldots,E_n)
\]

trong đó E có thể gồm:

- Data drift
- Data quality
- Prediction drift
- Performance delta
- Label coverage
- Data staleness
- Feature/pipeline signals
- Model lineage
- Training history
- HPO improvement signal

Không bắt buộc dùng deep learning/LLM.

Có thể bắt đầu bằng:

1. Rule-based baseline
2. Weighted evidence scoring
3. Probabilistic / calibrated classifier nếu phù hợp
4. Hybrid approach nếu có lợi

Phải bổ sung vào experimental design phép so sánh:

```text
D1 — Single-signal diagnosis
D2 — Rule-based multi-signal diagnosis
D3 — Proposed multi-evidence diagnosis
```

Mục tiêu: chứng minh multi-evidence thực sự tốt hơn single-signal.

---

## 2. Tách Severity thành một biến độc lập với Cause

Không định nghĩa severity chỉ bằng một ngưỡng performance.

Severity nên dựa trên:

\[
Severity =
f(
PerformanceImpact,
Scope,
Persistence,
Risk
)
\]

Trong đó:

- PerformanceImpact: mức suy giảm chất lượng
- Scope: tỷ lệ traffic/population bị ảnh hưởng
- Persistence: thời gian kéo dài
- Risk: mức độ nguy hiểm/business impact

Đề xuất taxonomy:

```text
S0 = No degradation
S1 = Early warning / low
S2 = Moderate
S3 = High
S4 = Critical
```

Có thể dùng performance threshold làm một input, nhưng không được biến nó thành toàn bộ định nghĩa severity.

Bổ sung vào Scenario Injector:

```json
{
  "severity": "S3",
  "severity_factors": {
    "performance_impact": 0.12,
    "scope": 0.65,
    "persistence": "6h",
    "risk": "high"
  }
}
```

Ground truth phải có thể giải thích được vì sao scenario thuộc severity đó.

---

## 3. Tách rõ RQ1 — Diagnosis, RQ2 — Decision, RQ3 — Outcome

Chỉnh Research Questions thành tối đa 3 RQ core:

### RQ1 — Diagnosis

> Can multi-evidence monitoring accurately distinguish different causes of model degradation compared with single-signal approaches?

Đánh giá:

- Diagnosis accuracy
- Macro-F1
- Confusion matrix
- Calibration
- Confidence quality

### RQ2 — Strategy Selection

> Can degradation-aware strategy selection reduce unnecessary retraining while maintaining appropriate maintenance decisions compared with generic retraining policies?

Đánh giá:

- Strategy accuracy
- Unnecessary retraining rate
- Missed-retraining rate
- Unsafe action rate
- Human intervention rate

### RQ3 — Outcome / Robustness

> How robust is the proposed approach under different degradation severities, mixed degradation, delayed labels, and noisy or incomplete evidence?

Đánh giá:

- Recovery
- Time-to-recovery
- Cost
- Robustness
- Sensitivity to delayed/noisy evidence

Cost và recovery là metrics phục vụ RQ2/RQ3, không cần tạo RQ riêng nếu làm đề cương dài.

---

## 4. Bổ sung diagnosis-level baselines và ablation

Giữ các operational baselines hiện tại:

```text
B0 — Static / No Retraining
B1 — Periodic Retraining
B2 — Single-Signal Drift-Triggered CT
B3 — Performance-Triggered CT
B4 — Always Retrain
B5 — Proposed Degradation-Aware Adaptive CT
```

Bổ sung diagnosis-level baselines:

```text
D1 — Single-Signal Diagnosis
D2 — Rule-Based Multi-Signal Diagnosis
D3 — Proposed Multi-Evidence Diagnosis
```

Thêm ablation:

```text
Full Evidence
vs
− Data Drift Evidence
vs
− Data Quality Evidence
vs
− Prediction Evidence
vs
− Performance Evidence
vs
− Lineage/Training Evidence
```

Nếu một evidence group không áp dụng cho một cause, ghi rõ trong experimental protocol thay vì cố ép tất cả scenario.

Mục tiêu là chứng minh:

1. Contribution đến từ diagnosis, không chỉ từ action policy.
2. Mỗi evidence group đóng góp thực sự.
3. Proposed method không chỉ thắng vì có nhiều threshold.

---

## 5. Xử lý Mixed Cause / Multi-Label Diagnosis

Scenario mixed phải hỗ trợ:

```text
Primary cause
Secondary causes
Confidence
```

Ví dụ:

```text
Data Drift
+
Data Quality
+
Performance degradation
```

Output không nên bị ép thành một nhãn tuyệt đối nếu evidence hỗ trợ nhiều nguyên nhân.

Ví dụ:

```json
{
  "cause_distribution": {
    "DATA_DRIFT": 0.72,
    "DATA_QUALITY": 0.21,
    "CONCEPT_DRIFT": 0.07
  },
  "primary_cause": "DATA_DRIFT",
  "secondary_causes": ["DATA_QUALITY"],
  "confidence": 0.72
}
```

Benchmark phải có:

- Single-cause scenarios
- Mixed-cause scenarios
- Ambiguous/overlapping evidence
- False-positive evidence
- Missing evidence

Evaluation phải hỗ trợ cả:

- Single-label diagnosis
- Multi-label diagnosis khi cần

---

# PART B — Thu hẹp scientific scope

## Core degradation classes cho Q3

Chỉ dùng 5 lớp trong core benchmark:

```text
C0 — BENIGN / NO_ACTION
C1 — DATA_DRIFT
C2 — DATA_QUALITY
C3 — CONCEPT_DRIFT
C4 — DATA_STALENESS
```

Không đưa các nhóm sau vào core diagnosis của Q3:

```text
CONFIGURATION_SUBOPTIMAL
TRAINING_CODE_ISSUE
FEATURE_CODE_ISSUE
INFRASTRUCTURE_ISSUE
ARCHITECTURE_LIMITATION
```

Chúng có thể xuất hiện dưới dạng:

- robustness/confounding scenarios
- supporting system capabilities
- future work

Lý do cần ghi trong đề cương:

> Những nhóm này có không gian phương pháp riêng rất lớn và nếu đưa vào core sẽ làm mất focus của research question về degradation-aware diagnosis và adaptive maintenance.

---

# PART C — Thu hẹp action space cho Q3

Core Q3 chỉ cần:

```text
A0 — NO_OP / OBSERVE
A1 — INCREMENTAL CT
A2 — FULL CT
A3 — HITL
```

Có thể giữ:

```text
DATA_ENGINEERING
HPO_CT
```

nhưng không coi là core scientific action classes.

HPO và data engineering nên là extension hoặc specialized implementation.

Đặc biệt:

> HPO không phải contribution chính của paper.

---

# PART D — Phân biệt Platform Scope và Research Scope

Trong đề cương phải có bảng:

| Thành phần | Platform role | Q3 | Q2 | Q1 stretch |
|---|---|---:|---:|---:|
| Monitoring | Core platform | Support | Support | Support |
| Data drift detection | Platform + evidence | Deep | Deep | Deep |
| Data quality | Platform + evidence | Deep | Deep | Deep |
| Concept drift | Research | Deep | Deep | Deep |
| Data staleness | Research | Moderate | Deep | Deep |
| Multi-evidence representation | Research | **Core** | **Core** | **Core** |
| Cause diagnosis | Research | **Core** | **Core** | **Core** |
| Severity estimation | Research | **Core** | **Core** | **Core** |
| Confidence estimation | Research | **Core** | **Core** | **Core** |
| Strategy selection | Research | **Core** | **Core** | **Core** |
| Incremental CT | Execution | Support | Deep | Deep |
| Full CT | Execution | Support | Support | Support |
| HITL | Safety | Support | Deep | Deep |
| HPO | Extension | Optional | Moderate | Deep |
| Engineering diagnosis | Future | No | Optional | Deep |
| Architecture diagnosis | Future | No | Optional | Deep |
| Shadow/Canary | Platform safety | Support | Support | Support |
| Rollback | Platform safety | Support | Support | Support |
| Causal diagnosis | Future | No | Optional | **Potential core** |
| Cross-domain generalization | Evaluation | Limited | **Required** | **Strong** |
| Adaptive/online policy learning | Future | No | Optional | **Potential core** |

---

# PART E — Xây roadmap Q3 → Q2 → Q1

## Stage Q3 — Baseline vững chắc

Mục tiêu:

> Hoàn thiện một empirical research prototype có thể chứng minh rõ rằng multi-evidence degradation diagnosis + adaptive strategy selection tốt hơn generic retraining policies.

### Q3 scope

```text
5 degradation classes
+
4 core actions
+
Multi-evidence diagnosis
+
Severity
+
Confidence
+
Ground-truth benchmark
+
B0–B5
+
D1–D3
+
Ablation
+
2–3 datasets/tasks
```

### Q3 minimum success criteria

Cần có bằng chứng cho:

1. Diagnosis tốt hơn single-signal.
2. Strategy selection giảm unnecessary retraining.
3. Recovery không kém đáng kể so với Always Retrain.
4. Compute/training cost giảm.
5. Robustness với delayed/noisy evidence ở mức cơ bản.

Nếu chỉ đạt được các điểm này, **đóng scope và hoàn thiện paper Q3**, không tiếp tục mở rộng chỉ vì muốn thêm tính năng.

---

# Stage Q2 — Deepen scientific contribution

Chỉ bắt đầu sau khi Q3 baseline đã ổn định.

Có thể chọn 2–3 hướng sau, không nhất thiết làm tất cả:

### Q2-A — Better diagnosis model

```text
Rule-based
→ Weighted evidence
→ Probabilistic / calibrated diagnosis
```

Nghiên cứu:

- uncertainty
- calibration
- confidence-aware decision
- ambiguous evidence

### Q2-B — More realistic degradation

Bổ sung:

- mixed degradation
- gradual drift
- recurring drift
- delayed labels
- noisy evidence
- partial observability

### Q2-C — Cross-domain generalization

Từ:

```text
1 task
```

sang:

```text
classification
+
regression
+
time-series / forecasting
```

hoặc ít nhất 2–3 task families.

### Q2-D — Cost-aware decision

Formalize:

\[
U(a|E) =
Benefit(a)
-
Cost(a)
-
Risk(a)
-
HumanEffort(a)
\]

và nghiên cứu Pareto trade-off:

```text
Recovery
vs
Compute Cost
vs
Risk
vs
Human Effort
```

### Q2-E — Confidence-aware HITL

Không chỉ:

```text
low confidence → HITL
```

mà nghiên cứu:

```text
confidence
+
risk
+
severity
→
automation boundary
```

Đây có thể là một contribution mạnh.

---

# Stage Q1 Stretch — Chỉ làm nếu Q2 evidence đủ mạnh

Không cam kết Q1.

Đề cương phải ghi rõ đây là **high-risk/high-reward research direction**.

Có thể chọn một trong các hướng:

## Q1-A — Causal degradation diagnosis

Từ:

```text
P(Cause | Evidence)
```

tiến tới:

```text
Causal explanation
```

Phân biệt:

```text
correlation
vs
causal evidence
```

Có thể nghiên cứu intervention/counterfactual:

```text
If data quality had remained stable,
would degradation still occur?
```

Đây là một bước scientific leap lớn.

---

## Q1-B — Online adaptive maintenance policy

Từ static policy:

```text
Evidence → Action
```

sang:

```text
Sequential evidence
        ↓
Adaptive policy
        ↓
Action
        ↓
Outcome
        ↓
Policy update
```

Có thể nghiên cứu:

- contextual bandit
- reinforcement learning
- online decision making

Chỉ làm nếu nền Q2 đã vững.

---

## Q1-C — Generalizable foundation across tasks

Không chỉ một MLOps pipeline.

Framework phải generalize:

```text
classification
regression
forecasting
possibly NLP / CV
```

và các degradation mechanisms khác nhau.

Điểm nhấn:

> Không phải “framework chạy được ở nhiều dataset”, mà là chứng minh một abstraction chung cho degradation-aware maintenance.

---

## Q1-D — Human-AI adaptive maintenance

Phát triển HITL thành:

```text
Model confidence
+
Risk
+
Human expertise
+
Historical decisions
        ↓
Adaptive automation boundary
```

Nghiên cứu khi nào nên:

- auto execute
- request human approval
- defer
- collect more evidence

Đây là hướng có khả năng tạo novelty cao nhưng cần experimental design rất mạnh.

---

# PART F — Ranh giới “đạt Q3 thì dừng” và “tiến lên Q2/Q1”

Tạo một bảng gate rõ ràng:

| Gate | Điều kiện | Quyết định |
|---|---|---|
| G0 | Research contract + taxonomy ổn định | Start implementation |
| G1 | Scenario benchmark + ground truth chạy ổn | Build diagnosis |
| G2 | Diagnosis beats single-signal baseline | Q3 core validated |
| G3 | Adaptive policy reduces unnecessary CT without hurting recovery | **Q3 paper-ready** |
| G4 | Results replicate across multiple tasks/scenarios | **Q2 candidate** |
| G5 | Strong robustness + uncertainty/cost-aware policy | **Q2 strong** |
| G6 | New scientific paradigm such as causal/online/generalizable adaptive policy | **Q1 stretch** |

Phải nhấn mạnh:

> Không dùng “Q3/Q2/Q1” như lời hứa về acceptance. Đây là **development maturity targets** dựa trên mức độ scientific depth và empirical rigor.

---

# PART G — Experimental strategy theo từng level

## Q3 experiment matrix

```text
Datasets: 2–3
Causes: 5
Actions: 4
Baselines: B0–B5
Diagnosis baselines: D1–D3
Severity: S0–S4
Delayed labels: basic
Mixed causes: basic
Ablation: evidence groups
```

Mục tiêu:

```text
Diagnosis ↑
Unnecessary CT ↓
Cost ↓
Recovery maintained
```

## Q2 experiment matrix

Thêm:

```text
More datasets/tasks
More drift shapes
Mixed causes
Noisy/missing evidence
Longer delayed-label windows
Calibration
Uncertainty
Cost-risk Pareto
Cross-domain generalization
```

## Q1 experiment matrix

Chỉ nếu đã có phương pháp mới thực sự:

```text
Causal / online / adaptive / generalizable method
+
Strong baselines
+
Multiple public datasets
+
Realistic scenarios
+
Ablation
+
Statistical significance
+
Failure analysis
+
Reproducibility
```

---

# PART H — Những gì KHÔNG nên làm để tránh scope creep

Không biến project thành đồng thời:

```text
MLOps platform
+
AutoML
+
HPO
+
Causal AI
+
RL
+
LLM agent
+
Architecture search
+
Infrastructure research
```

Đây là các hướng riêng.

Nếu phát triển Q1, phải chọn **một scientific leap chính**.

Ví dụ tốt:

```text
Q3:
Multi-evidence diagnosis

Q2:
Uncertainty + cost-aware adaptive policy

Q1:
Causal/online adaptive maintenance
```

Thay vì:

```text
Q3:
7 causes

Q2:
12 causes

Q1:
20 causes
```

Mở rộng số lượng nguyên nhân không tự động làm paper mạnh hơn.

---

# PART I — Research Contribution Ladder

Bắt buộc thêm một hình hoặc bảng tương tự:

```text
                    Q1 STRETCH
                        ▲
                        │
          Causal / Online / Generalizable
          Adaptive Maintenance
                        │
                        │
                    Q2 LEVEL
                        ▲
                        │
          Uncertainty + Cost/Risk
          + Cross-domain Robustness
                        │
                        │
                    Q3 LEVEL
                        ▲
                        │
          Multi-Evidence Diagnosis
          + Severity + Confidence
          + Adaptive Strategy Selection
                        │
                        │
                 EXISTING PLATFORM
                        │
          Monitoring / Retraining /
          Lineage / Evaluation
```

Thông điệp:

> Mỗi level phải **kế thừa kết quả của level trước**, không phải viết lại toàn bộ hệ thống.

---

# PART J — Final Roadmap Table

Bổ sung bảng cuối:

| Level | Scientific Question | Core Method | Scope | Main Evidence | Exit Criterion |
|---|---|---|---|---|---|
| Existing | Can platform support continuous maintenance? | MLOps platform | Broad | System functionality | Platform stable |
| Q3 | Can multi-evidence diagnosis improve adaptive maintenance? | Evidence scoring + diagnosis + policy | 5 causes | B0–B5, D1–D3, 2–3 tasks | Q3-ready empirical result |
| Q2 | Can uncertainty/cost-aware adaptive maintenance generalize robustly? | Calibrated diagnosis + risk/cost policy | More tasks + realistic degradation | Robustness + Pareto + ablation | Strong Q2 candidate |
| Q1 stretch | Can maintenance decisions become causal/online/generalizable? | Causal or online adaptive policy | Broad | Strong multi-domain evidence | Novel paradigm + rigorous validation |

---

# PART K — Yêu cầu về cấu trúc của bản đề cương sau khi chỉnh

Bản đề cương cuối cùng phải có thứ tự:

1. Existing MLOps System
2. Research Motivation
3. Research Gap
4. Research Problem
5. Research Questions
6. Research Hypotheses
7. Degradation Taxonomy
8. Evidence Matrix
9. Ground-Truth Design
10. Multi-Evidence Diagnosis
11. Severity & Confidence
12. Adaptive Strategy Selection
13. Experimental Benchmark
14. Baselines
15. Ablation
16. Evaluation Metrics
17. Q3 Scope
18. Q2 Extension
19. Q1 Stretch
20. Implementation Roadmap
21. Research Maturity Gates
22. Risks & Scope Control
23. Expected Contributions
24. Publication Positioning

---

# PART L — Nguyên tắc cuối cùng

Khi chỉnh sửa đề cương, hãy luôn giữ nguyên nguyên tắc:

> **Platform có thể rộng, nhưng scientific question phải hẹp.**

Core scientific chain:

```text
Degradation
    ↓
Evidence
    ↓
Diagnosis
    ↓
Severity + Confidence
    ↓
Strategy
    ↓
Outcome
```

Và mục tiêu nghiên cứu:

\[
\boxed{
\text{Adaptive Maintenance}
>
\text{Generic Retraining}
}
\]

phải được chứng minh bằng thực nghiệm chứ không chỉ bằng kiến trúc.

Nếu có phần nào của đề cương hiện tại mâu thuẫn với các nguyên tắc trên, ưu tiên **giữ terminology và cấu trúc hiện có khi có thể**, nhưng chỉnh scope và dependency để bảo đảm câu chuyện nghiên cứu nhất quán.

## Deliverable mong muốn

Sau khi chỉnh sửa, bản đề cương phải cho phép người thực hiện:

1. Làm hết Q3 mà **không cần Q2/Q1**.
2. Nếu Q3 đạt tốt, có đường nâng cấp rõ ràng lên Q2.
3. Nếu Q2 đạt tốt, có một hoặc vài hướng Q1 có cơ sở.
4. Có thể dừng ở bất kỳ gate nào mà vẫn có một research artifact hoàn chỉnh.
5. Không phải rewrite architecture từ đầu khi chuyển Q3 → Q2 → Q1.
