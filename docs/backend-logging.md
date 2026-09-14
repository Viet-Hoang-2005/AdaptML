# Backend container logging

Each backend service owns its logging code. Application logs go to standard output
and use the same policy locally and in K3s.

## Output modes

`LOG_FORMAT=console` is the default, including when the variable is missing or
invalid. It keeps routine container output readable:

```text
2026-09-14T14:26:11.912Z [INFO]: Listening on TCP address 0.0.0.0:8000
```

Use `LOG_FORMAT=json` before reproducing an incident when correlation metadata is
needed. Each application event is valid, single-line JSON and includes `ts`,
`level`, `service`, `event`, instance/process information, available resource
IDs, summary counters, retry data, and a compact traceback for errors.

Changing this value affects only newly started services or jobs. For Docker Compose,
set it in the shell or `.env` and recreate the relevant container.

## Event policy

- Lifecycle operations emit start, dispatch, completion, failure, retry, and
  cancellation messages that are meaningful without hidden metadata.
- High-volume HTTP, inference, and consumer work is summarized once per process
  every 60 seconds. Health checks and successful access logs are suppressed.
- Console error lines include a sanitized error type, reason when supplied, and a
  compact `file:line:function` traceback. Only the boundary that handles an error
  emits the traceback.

## Safety and compatibility

Redaction applies to both modes: credentials, authorization headers, credentialed
URLs, signatures, and private-key material are removed. Request bodies, features,
predictions, environment dumps, and untrusted job output are not emitted as
application logs.

Runtime job protocols remain unchanged. In particular, `METRIC_JSON` and
`BUILD_EOF_*` are not converted into operational JSON. Redis job-log delivery
continues independently of the container formatter.
