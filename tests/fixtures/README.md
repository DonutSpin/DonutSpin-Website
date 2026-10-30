# Test fixtures

`smtp-test-cert.pem` / `smtp-test-key.pem` are a throwaway self-signed
certificate for `CN=localhost` (SAN `DNS:localhost`, `IP:127.0.0.1`), valid for
ten years. They are used only by `tests/helpers/smtp-sink.ts`, the local STARTTLS
SMTP server that proves nodemailer can deliver verification and password-reset
mail. They are not used by the application, are not trusted by anything, and
must never be deployed.
