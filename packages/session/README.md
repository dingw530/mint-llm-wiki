# @mint/session

Provider-neutral conversation event contracts and pure model-history, trace, and crash-recovery projections.

The package does not open storage, decrypt payloads, claim execution ownership, authorize tools, call models, or execute tools. The Mint host must validate conversation access, persist and encrypt events, combine dispatch commits with its Tool Invocation Ledger transaction, and call `planSessionRecovery` only after it has established that the run owner is no longer active.

`validateSessionEventBatch` validates a contiguous append without requiring referenced earlier events in the same batch. `validateSessionEvents` validates a complete prefix, including model call, dispatch, and result pairing. Both reject unsupported schema versions, malformed JSON, duplicate identities, and sequence gaps. Projection methods return new values and never change their inputs. `planSessionRecovery` returns synthetic results for dangling tool calls but performs no writes and never replays the call. The host applies the plan through compare-and-swap on the returned `expectedLastSequence`.

The trace subpath contains only safe, non-content preview DTOs. Full tool arguments and model-visible results belong in separately authorized detail reads.
