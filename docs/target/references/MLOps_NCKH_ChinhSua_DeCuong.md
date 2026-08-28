# Đề xuất chỉnh sửa đề cương NCKH – Degradation-Aware Adaptive Model Maintenance

## 0. Mục đích của tài liệu

Tài liệu này là **specification để Codex chỉnh sửa lại đề cương/báo cáo hiện tại**, không phải tài liệu viết paper hoàn chỉnh.

Mục tiêu là giữ lại phần lớn kiến trúc MLOps hiện có nhưng:
- thu hẹp scope engineering;
- làm rõ research question và scientific contribution;
- formalize degradation diagnosis, severity và intervention policy;
- thiết kế benchmark để chứng minh hiệu quả;
- không tích hợp LLM vào hệ thống;
- định vị repo như **experimental platform**, không phải contribution duy nhất.

---

# 1. Định vị lại đề tài

## 1.1. Không định vị đề tài là

- “Drift detection and automatic retraining”
- “Automatic model retraining based on drift”
- “A Kubernetes-based MLOps platform”
- “An MLOps platform with many cloud-native components”

Các hướng trên đã có nhiều công trình hoặc thiên về engineering.

## 1.2. Định vị đề tài theo hướng

### Tên định hướng

**Degradation-Aware Adaptive Model Maintenance for Continuous Training**

Có thể dùng tên mạnh hơn trong paper:

**Risk-Guided Continuous Training through Multi-Signal Model Degradation Diagnosis**

Hoặc:

**A Degradation-Aware Decision Framework for Adaptive Continuous Model Maintenance**

## 1.3. Research problem trung tâm

Không đặt câu hỏi:

> Khi drift xảy ra thì có nên retrain hay không?

Mà đặt câu hỏi:

> Khi production model xuất hiện nhiều tín hiệu suy giảm, làm thế nào hệ thống có thể xác định nguyên nhân, mức độ nghiêm trọng và độ tin cậy của bằng chứng để lựa chọn hành động bảo trì phù hợp, an toàn và tiết kiệm?

Luận đề trung tâm:

> **Drift ≠ Degradation ≠ Retraining Trigger**

Một hệ thống Continuous Training đáng tin cậy không nên tự động retrain chỉ vì một drift alert đơn lẻ.

---

# 2. Kiến trúc nghiên cứu cần giữ

Giữ kiến trúc closed-loop:

```text
Production Inference
        ↓
Feedback / Delayed Labels
        ↓
Evidence Window
        ↓
Multi-Signal Monitoring
        ↓
Degradation Detection
        ↓
Diagnosis
 ┌──────┼───────────────┐
 │      │               │
Cause Severity      Confidence
 └──────┼───────────────┘
        ↓
Risk / Policy Decision
 ┌──────┼───────────────┐
 ↓      ↓               ↓
NO-OP  Auto CT          HITL
 │      │               │
 │      ↓               ↓
 │   Retraining      Human Review
 │      │               │
 └──────┼───────────────┘
        ↓
Evaluation Gate
        ↓
Shadow / Canary
        ↓
Promotion / Rollback
```

### Nguyên tắc

- Monitoring tạo evidence.
- Diagnosis giải thích evidence.
- Policy quyết định action.
- Retraining chỉ là **một trong nhiều action**.
- Evaluation Gate là cơ chế an toàn.
- Registry/deployment chỉ nhận candidate đã vượt gate.

---

# 3. Phân tầng scope

## 3.1. Core Research – MUST HAVE

Đây là phần phải ưu tiên:

```text
Multi-signal detection
        ↓
Degradation diagnosis
        ↓
Severity + confidence
        ↓
Adaptive intervention policy
        ↓
Conditional CT / HITL / No-op
        ↓
Evaluation
```

## 3.2. Supporting Engineering – SHOULD HAVE

Các thành phần cần để chạy nghiên cứu:

- PredictionRecord
- Feedback API
- Delayed labels
- EvidenceWindow
- Event-driven workflow
- Argo Workflows / Argo Events
- Training runner / Kubeflow
- MLflow
- Registry
- Evaluation Gate
- Audit trail

Không coi các thành phần này là novelty chính.

## 3.3. Stretch / Optional

Chỉ làm nếu còn thời gian:

- Canary production hoàn chỉnh
- Advanced HPO
- Feature Store
- Inference Engine Pool
- advanced XAI
- các platform-builder UI phức tạp

**Không tích hợp LLM vào hệ thống và không đưa LLM thành contribution.**

---

# 4. Không xây lại pipeline orchestration

Nếu báo cáo hiện tại đề xuất phát triển một “ML Pipeline Builder/Deployer” mới, cần viết lại.

Repo đã có:

```text
Argo
Kubeflow
MLflow
Docker/Kubernetes
```

Do đó chỉ cần:

```text
RetrainingRequest
        ↓
Argo Event
        ↓
Argo Workflow
        ↓
Training
        ↓
Evaluation
        ↓
MLflow Registry
```

Research contribution nằm ở:

> **Decision layer xác định khi nào và vì sao CT pipeline được kích hoạt.**

Không biến paper thành bài về orchestration framework.

---

# 5. Feedback và delayed labels

Giữ và nhấn mạnh Phase Feedback Infrastructure.

Kiến trúc:

```text
Prediction
    ↓
prediction_id
    ↓
PredictionRecord
    ↓
Feedback / Ground Truth
    ↓
EvidenceWindow
```

Cần có:

- prediction timestamp;
- label timestamp;
- watermark;
- label coverage;
- minimum label requirement.

Quy tắc:

```text
label_coverage < r_min
        ↓
INSUFFICIENT_LABELS
        ↓
NO AUTO CT
```

Điểm cần nhấn mạnh trong báo cáo:

> Không được tuyên bố performance degradation khi chưa có ground truth đủ tin cậy.

---

# 6. Multi-signal degradation detection

Không dùng drift detector đơn lẻ.

Evidence nên bao gồm:

```text
Data Drift
Prediction Drift
Data Quality
Performance
Label Coverage
Confidence / Uncertainty
```

Ví dụ:

```text
PSI
KS
Wasserstein
Prediction distribution shift
F1
Precision
Recall
ECE / Brier
Missing rate
Invalid rate
Label coverage
```

Mục tiêu khoa học:

> Chứng minh rằng **drift không đồng nghĩa với harmful degradation**.

---

# 7. Formalize Degradation Diagnosis

Không chỉ output:

```text
DRIFT = TRUE
```

Cần output có cấu trúc:

```json
{
  "cause": "HARMFUL_DRIFT",
  "severity": "HIGH",
  "confidence": 0.93,
  "evidence": {
    "psi": 0.31,
    "f1_delta": -0.082,
    "label_coverage": 0.84
  },
  "recommended_action": "AUTO_CT"
}
```

## 7.1. Cause taxonomy

Tối thiểu:

```text
NORMAL / STABLE
BENIGN_DRIFT
HARMFUL_DRIFT
DATA_QUALITY_FAILURE
CONCEPT_SHIFT / UNEXPLAINED_DEGRADATION
INSUFFICIENT_EVIDENCE
MIXED / AMBIGUOUS
```

## 7.2. Severity

Không chỉ phân loại cause; cần formalize severity:

```text
S0 = Normal
S1 = Benign / Low
S2 = Moderate
S3 = Severe
S4 = Critical
```

Severity có thể dựa trên:

```text
drift magnitude
+
performance degradation
+
statistical significance
+
label confidence
+
business impact
+
diagnosis confidence
```

Không bắt buộc phải dùng đúng công thức trên, nhưng báo cáo phải giải thích rõ severity được xác định như thế nào.

---

# 8. Adaptive Intervention Policy

Đây là **research core**.

Không dùng:

```text
drift > threshold
    ↓
retrain
```

Mà:

```text
Evidence
   ↓
Diagnosis
   ↓
Severity
   ↓
Confidence
   ↓
Policy
```

Action space:

```text
NO_OP
DATA_ENGINEERING
INCREMENTAL_RETRAIN
FULL_RETRAIN
HITL
```

Ví dụ:

```text
Benign drift
    → NO_OP / OBSERVE

Data quality failure
    → DATA_ENGINEERING

Moderate harmful drift
    → INCREMENTAL_RETRAIN

Severe harmful degradation
    → FULL_RETRAIN

Unexplained / low confidence
    → HITL
```

Policy phải có:

- cooldown;
- deduplication;
- label sufficiency;
- quality gate;
- budget/cost constraints;
- minimum improvement threshold;
- confidence threshold.

---

# 9. HITL phải là một phần nghiên cứu

Không thiết kế HITL chỉ như một nút Approve/Reject.

Flow:

```text
Degradation
      ↓
Low confidence / high risk
      ↓
HITL
      ↓
Human decision
 ┌────┴────┐
 ↓         ↓
Approve   Reject
 ↓         ↓
CT       NO-OP
```

Lưu:

```text
human_decision
timestamp
reason
system_recommendation
final_action
outcome
```

Từ đó đo:

- human intervention rate;
- human effort;
- approval rate;
- rejection rate;
- disagreement rate;
- unsafe automation rate.

Mục tiêu:

> Tự động hóa những case có evidence đủ mạnh và chuyển case rủi ro/không chắc chắn cho con người.

---

# 10. Evaluation Gate

Giữ:

```text
Candidate
   ↓
Offline Evaluation
   ↓
Shadow
   ↓
Canary (optional/SHOULD HAVE)
   ↓
Promotion / Rollback
```

Evaluation Gate phải kiểm tra:

- predictive performance;
- recall/precision/F1;
- calibration;
- latency;
- resource usage;
- business constraints;
- regression against champion.

Ví dụ:

```text
candidate_f1 >= champion_f1
candidate_recall >= minimum_recall
candidate_latency <= max_latency
```

Nếu fail:

```text
REJECT
```

Không để LLM hoặc policy layer tự bypass Evaluation Gate.

---

# 11. Research hypotheses – sửa cách phát biểu

Không dùng hypothesis tuyệt đối kiểu:

> H1: giảm hơn 90% unnecessary CT.

hoặc:

> H2: ngăn 100% unsafe retraining.

Các con số này nên trở thành **target/expected outcome**, không phải định nghĩa hypothesis.

Đề xuất:

### H1

> The proposed degradation-aware policy significantly reduces unnecessary retraining compared with alert-driven and periodic continuous training while maintaining comparable degradation recovery.

### H2

> Multi-signal diagnosis reduces false retraining decisions compared with single-signal drift-triggered retraining.

### H3

> Risk-aware intervention with HITL reduces unsafe automation for ambiguous or low-confidence degradation cases.

### H4

> The proposed approach improves the trade-off between performance recovery, retraining cost, and human intervention compared with conventional CT policies.

Nếu có LLM thì bỏ hoàn toàn khỏi hypothesis vì quyết định **không tích hợp LLM**.

---

# 12. Không dùng ROICT > 1 như một điều kiện cứng

Nếu báo cáo đang có:

```text
ROICT > 1
```

thì sửa.

Lý do:

- Performance;
- Business Value;
- Compute Cost;
- Risk

có thể không cùng đơn vị.

Thay bằng cost-effectiveness analysis:

```text
Performance Recovery
Unnecessary CT
Compute Cost
Human Effort
Time-to-Recovery
Unsafe Automation
```

Nếu muốn composite utility:

```text
Utility =
Performance Benefit
- λ1 × Compute Cost
- λ2 × Human Cost
- λ3 × Risk
```

Phải giải thích các hệ số λ.

Không tuyên bố một threshold như “>1” nếu chưa có cơ sở thực nghiệm/định lượng rõ ràng.

---

# 13. Benchmark scenarios

Giữ các scenario hiện có:

```text
S0 Stable
S1 Benign Drift
S2 Harmful Drift
S3 Data Quality Failure
S4 Concept Shift
S9 Mixed Signals
```

Bổ sung:

## S10 – False Drift Signal

Drift detector báo drift nhưng model performance không giảm.

Mục tiêu:

```text
drift alert
    ↓
NO unnecessary CT
```

## S11 – Delayed / Insufficient Labels

Có tín hiệu nghi ngờ degradation nhưng label coverage chưa đủ.

Mục tiêu:

```text
INSUFFICIENT_LABELS
    ↓
NO AUTO CT
```

Mỗi scenario phải có **ground-truth cause**.

Ví dụ:

```text
Scenario Injector
       ↓
Known degradation cause
       ↓
Production simulation
       ↓
System diagnosis
       ↓
Compare predicted cause vs true cause
```

Đây là điều bắt buộc để đánh giá diagnosis.

---

# 14. Baselines

Benchmark ít nhất:

```text
B0 No Retraining / Static
B1 Periodic Retraining
B2 Drift-triggered Retraining
B3 Performance-triggered Retraining
B4 Rule-based Adaptive CT
B5 Proposed Degradation-Aware Policy
```

Nếu muốn mở rộng thuật toán diagnosis:

```text
B6 Single-signal
B7 Multi-signal rule-based
B8 Proposed policy
```

Không cần thêm LLM baseline.

---

# 15. Metrics

## Detection

- Precision
- Recall
- F1
- Detection Delay
- False Positive Rate

## Diagnosis

- Accuracy
- Macro-F1
- Confusion Matrix
- Top-k accuracy nếu có nhiều cause

## Decision

- Strategy Accuracy
- Unnecessary CT Rate
- Missed Degradation Rate
- Unsafe Automation Rate

## Maintenance

- Performance Recovery
- Time-to-Recovery
- Number of Retraining Runs
- Rollback Rate

## Cost

- GPU/CPU hours
- Training time
- Human effort
- Number of manual approvals

---

# 16. Ba metric đặc biệt cần bổ sung

## 16.1. Unnecessary Retraining Rate

```text
Unnecessary CT
───────────────
Total CT
```

## 16.2. Missed Degradation Rate

```text
Harmful degradation không được xử lý
────────────────────────────────────
Total harmful degradation cases
```

## 16.3. Unnecessary Retraining Reduction

```text
URR =
1 -
Unnecessary_CT_proposed
──────────────────────
Unnecessary_CT_baseline
```

Các metric này trực tiếp chứng minh research claim.

---

# 17. Benchmark phải trả lời 4 câu hỏi

### Q1

Hệ thống có phát hiện degradation tốt không?

### Q2

Hệ thống có phân biệt được:

```text
Drift
vs
Harmful degradation
vs
Data quality
vs
Concept shift
```

không?

### Q3

Hệ thống có chọn đúng action không?

```text
NO-OP
DATA ENGINEERING
INCREMENTAL CT
FULL CT
HITL
```

### Q4

Hệ thống có giảm chi phí mà không làm tăng missed degradation/unsafe automation không?

---

# 18. Ablation study

Nên có:

```text
A0 Single-signal drift
A1 Multi-signal detection
A2 + Diagnosis
A3 + Severity
A4 + Adaptive Policy
A5 + HITL
A6 Full system
```

Mục tiêu:

> Chứng minh từng thành phần thực sự đóng góp vào kết quả, thay vì toàn bộ improvement đến từ một thành phần khác.

---

# 19. Sensitivity analysis

Test các threshold:

```text
drift threshold
performance degradation threshold
label coverage threshold
confidence threshold
cooldown
minimum improvement
```

Ví dụ:

```text
label coverage:
0.5 / 0.7 / 0.8 / 0.9

performance drop:
3% / 5% / 10% / 15%
```

Đánh giá:

```text
CT frequency
False CT
Missed degradation
Recovery
Cost
```

---

# 20. Research contribution cần viết lại

Đề xuất 3 contribution chính.

## Contribution 1 – Degradation Taxonomy

Một taxonomy phân biệt:

```text
Stable
Benign Drift
Harmful Drift
Data Quality Failure
Concept Shift
Insufficient Evidence
Ambiguous
```

dựa trên multi-signal evidence.

## Contribution 2 – Risk-aware Adaptive Intervention Policy

Một policy chuyển:

```text
Evidence
→ Cause
→ Severity
→ Confidence
→ Action
```

với action space:

```text
No-op
Data Engineering
Incremental CT
Full CT
HITL
```

## Contribution 3 – Closed-loop MLOps Experimental Framework

Implementation:

```text
Detection
→ Diagnosis
→ Policy
→ CT
→ Evaluation
→ Promotion/Rollback
```

Repo là experimental platform để đánh giá framework.

---

# 21. Không claim novelty sai

Không được viết:

> “This is the first work to connect drift detection and retraining.”

Không được viết:

> “No previous work has automated retraining.”

Không được viết:

> “No previous work has used HITL for retraining.”

Các hướng trên đã có literature.

Novelty cần tập trung vào:

> **Multi-signal degradation diagnosis + severity/confidence + risk-aware intervention selection + quantitative evaluation of unnecessary CT, missed degradation, cost and human intervention in a unified closed-loop framework.**

Phải có literature review để chứng minh khoảng trống này trước khi dùng từ “novel” hoặc “first”.

---

# 22. Repo phải được mô tả như Experimental Platform

Trong báo cáo, phân biệt:

```text
Scientific Contribution
        ≠
Engineering Implementation
```

### Scientific

```text
Taxonomy
Diagnosis
Severity
Policy
Benchmark
Metrics
```

### Engineering

```text
Django
Kubernetes
Argo
Kubeflow
MLflow
Harbor
Prometheus/Grafana
Redpanda
```

Không dùng số lượng technology làm bằng chứng novelty.

---

# 23. Roadmap 26 tuần đề xuất

## Stage 1 – Foundation

Week 1–4

```text
Dataset
Scenario Injector
Baselines
Vertical Slice
Reproducibility
```

Output:

```text
S0/S1/S2
→ Detect
→ Retrain
→ Evaluate
```

## Stage 2 – Evidence Infrastructure

Week 5–9

```text
PredictionRecord
Feedback
Delayed Labels
EvidenceWindow
Data Quality
```

## Stage 3 – Degradation Diagnosis

Week 10–13

```text
Multi-signal Detection
Cause
Severity
Confidence
DegradationEvent
```

## Stage 4 – Adaptive Decision Intelligence

Week 14–17

```text
Diagnosis
→ Policy
→ No-op / Incremental / Full CT / HITL / Engineering
```

Đây là **core research phase**.

## Stage 5 – Safe CT

Week 18–23

```text
Retraining
→ Candidate
→ Evaluation Gate
→ Shadow
→ Canary (nếu đủ thời gian)
→ Registry
```

## Stage 6 – Scientific Evaluation

Week 24–26

```text
Baselines
Scenarios
Ablation
Sensitivity
Cost
HITL
Statistical Analysis
Paper
```

---

# 24. Ưu tiên triển khai

Thứ tự bắt buộc:

```text
1. Prediction ID + Feedback
        ↓
2. Delayed Label + EvidenceWindow
        ↓
3. Data Quality + Drift + Performance
        ↓
4. DegradationEvent
        ↓
5. Rule-based Diagnosis
        ↓
6. RetrainingRequest
        ↓
7. Argo → Training
        ↓
8. Evaluation Gate
        ↓
9. Registry
        ↓
10. Shadow
        ↓
11. Benchmark
        ↓
12. Ablation/Sensitivity
        ↓
13. Paper
```

**Không làm UI phức tạp trước benchmark.**

**Không làm Canary production hoàn chỉnh trước khi có experimental results.**

---

# 25. Tiêu chí “research-ready”

Trước khi viết paper, repo phải có thể chạy reproducibly:

```text
Scenario
    ↓
Data / event generation
    ↓
Detection
    ↓
Diagnosis
    ↓
Policy
    ↓
Action
    ↓
Training
    ↓
Evaluation
    ↓
Promotion / Rejection
```

Một experiment phải có:

```text
config
dataset/scenario
random seed
model version
policy version
metrics
logs
decision trace
```

Mục tiêu là một người khác có thể chạy lại experiment và thu được kết quả tương đương.

---

# 26. Tiêu chuẩn để quyết định Q3 / Q2 / Q1

## Q3-level target

Có:

- working closed-loop system;
- multi-signal detection;
- diagnosis;
- conditional CT;
- benchmark;
- quantitative results.

## Q2-level target

Ngoài các phần trên phải có:

- strong baselines;
- multiple degradation scenarios;
- ablation;
- sensitivity;
- cost analysis;
- HITL evaluation;
- statistical significance;
- reproducibility.

## Q1 / top-tier stretch

Cần thêm:

- generalizable/formalized policy;
- strong novelty;
- multiple datasets/domains;
- extensive experiments;
- convincing real-world or realistic validation;
- rigorous statistical analysis;
- clear theoretical/algorithmic contribution.

Không cam kết Q1/Q2 trước khi có kết quả.

---

# 27. Cấu trúc báo cáo/paper đề xuất

## 1. Introduction

Problem:

```text
Model degradation
≠
Drift
≠
Retraining trigger
```

Research gap.

Research questions.

Contributions.

## 2. Background & Related Work

- MLOps
- Model monitoring
- Drift detection
- Continuous Training
- Model maintenance
- Adaptive retraining
- HITL

Phải chỉ rõ các công trình đã có và khoảng trống.

## 3. Problem Formulation

Formalize:

```text
Evidence
Diagnosis
Severity
Confidence
Action
```

## 4. Proposed Framework

Architecture.

EvidenceWindow.

Diagnosis.

Policy.

HITL.

Evaluation Gate.

## 5. Implementation

Repo architecture và technology stack.

## 6. Experimental Setup

Datasets.

Scenario injector.

Baselines.

Metrics.

## 7. Results

Detection.

Diagnosis.

Policy.

Cost.

HITL.

Ablation.

Sensitivity.

## 8. Discussion

Trade-offs.

Failure cases.

Limitations.

Generalization.

## 9. Conclusion

Findings.

Future work.

---

# 28. Quy tắc cho Codex khi chỉnh sửa báo cáo

1. **Không tự ý xóa kiến trúc hiện tại nếu không mâu thuẫn với research core.**
2. **Không thêm LLM.**
3. **Không biến repo thành một platform-building project.**
4. **Không claim novelty tuyệt đối nếu chưa có literature evidence.**
5. **Giữ thuật ngữ nhất quán:**
   - degradation;
   - drift;
   - diagnosis;
   - severity;
   - confidence;
   - intervention policy;
   - continuous training;
   - HITL;
   - evaluation gate.
6. Mọi hypothesis phải có metric để kiểm chứng.
7. Mọi research claim phải có experiment tương ứng.
8. Mọi scenario phải có ground-truth cause.
9. Phân biệt rõ:
   - engineering component;
   - research component.
10. Nếu phải cắt scope, ưu tiên giữ **Diagnosis + Policy + Benchmark**, cắt UI/Canary/advanced infrastructure trước.

---

# 29. Final target architecture

```text
                         PRODUCTION
                             │
                             ▼
                     PredictionRecord
                             │
                             ▼
                    Feedback / Labels
                             │
                             ▼
                      EvidenceWindow
                             │
                             ▼
                 ┌─────────────────────┐
                 │ Multi-Signal Monitor│
                 ├─────────────────────┤
                 │ Data Drift          │
                 │ Prediction Drift    │
                 │ Data Quality        │
                 │ Performance         │
                 │ Label Coverage      │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Degradation         │
                 │ Diagnosis            │
                 ├─────────────────────┤
                 │ Cause               │
                 │ Severity            │
                 │ Confidence          │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Risk-Aware Policy   │
                 └──────────┬──────────┘
                            │
          ┌─────────────────┼──────────────────┐
          ▼                 ▼                  ▼
        NO-OP          CONDITIONAL CT          HITL
          │                 │                  │
          │                 ▼                  ▼
          │          Incremental / Full     Approve/Reject
          │                 │                  │
          └─────────────────┼──────────────────┘
                            ▼
                    Evaluation Gate
                            │
                    ┌───────┴────────┐
                    ▼                ▼
                  PASS              FAIL
                    │                │
                    ▼                ▼
              Shadow/Canary        Reject
                    │
                    ▼
              Model Registry
                    │
                    ▼
             Promotion / Deploy
                    │
                    └──── Feedback loop ────►
```

---

# 30. Kết luận định hướng

Đề tài **không nên được trình bày như một bài xây dựng MLOps platform**.

Định vị chính:

> **A degradation-aware decision framework for adaptive continuous model maintenance.**

Repo là nền tảng thực nghiệm để chứng minh:

```text
Multi-signal Evidence
        ↓
Degradation Diagnosis
        ↓
Severity + Confidence
        ↓
Risk-aware Intervention
        ↓
Conditional Continuous Training
        ↓
Evaluation / Safe Promotion
```

Research claim cần hướng tới:

> **Giảm unnecessary retraining và unsafe automation mà không làm tăng missed degradation, đồng thời duy trì khả năng recovery của model.**

Đây là tiêu chuẩn cần dùng để quyết định thành công của đề tài, không phải số lượng microservices hay số lượng công nghệ cloud-native được tích hợp.
