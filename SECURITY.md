# Security

## Reporting Issues

Please report security issues privately to the maintainer if contact information is available in the repository metadata. Do not publish exploit details before a fix is available.

## Security Model

`Authentication-Results` headers can be forged by senders. This project follows the RFC 8601 trust-boundary model:

- Authentication results are not trusted automatically.
- Users must explicitly choose trusted authentication service domains.
- Untrusted pass results are not treated as safety evidence.
- Untrusted authentication result headers are treated as suspicious.

## Storage Bounds

Persistent storage is intentionally bounded:

- Untrusted `authserv-id` candidates: 50 entries.
- Decision logs: 200 entries.

Trusted-domain hosts are not stored as hidden candidate history.

## External Communication

The add-on must not send mail data to external services.
