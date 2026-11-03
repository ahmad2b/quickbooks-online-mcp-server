# Books request outcomes

Finance authorizes every request before the MCP server constructs a provider
client. A refusal is a tool result, not evidence that QuickBooks was queried.
The server accepts only known Finance error codes and discards downstream error
messages. Error bodies are bounded to 64 KiB. Unknown, malformed and oversized
responses fail closed with a fixed message.

The MCP result metadata carries `errorCode` for operators and
`providerAttempted` for execution evidence:

- `false`: the request stopped before provider-client execution, for example a
  refused or unavailable lease. Human copy states that it was not attempted.
- `true`: an SDK method was invoked. A failure establishes an attempted request,
  not an empty result or a definitive posting outcome. Known transport failures
  have their own code. Raw provider error text is never returned.
- `null`: the handler did not return a confirmed result and SDK invocation was
  not observed. This is uncertainty, not evidence of no external side effect.
  In particular, a raw upload may run outside the SDK method wrapper.

| Operator code | Meaning / next step |
|---|---|
| QBO_REAUTHORIZATION_REQUIRED | Reconnect Books. |
| QBO_ACCESS_NOT_ALLOWED | Allow Penny on the Business page. |
| QBO_BUSINESS_STOPPED | Do not retry; explicitly Resume on the Business page. |
| QBO_ENVIRONMENT_MISMATCH | Books cannot be used here; ask the owner to check the connection. No environment routing is introduced. |
| QBO_EXECUTION_LEASE_UNAVAILABLE | Access is temporarily unavailable; request was not attempted. |
| QBO_EXECUTION_LEASE_INVALID | Access could not be confirmed; request was not attempted. |
| QBO_PROVIDER_REQUEST_FAILED | SDK request was attempted but returned no confirmed result. |
| QBO_PROVIDER_TRANSPORT_FAILED | SDK request was attempted; connection failure prevented a confirmed result. |
| QBO_REQUEST_OUTCOME_UNCONFIRMED | Attempt/outcome cannot be established from the handler result. |

Success content remains unchanged. A successful read can establish an empty
result; a missing or failed result cannot. Before retrying a change, check the
Books for its outcome. These messages grant no new authority or approval bypass.
