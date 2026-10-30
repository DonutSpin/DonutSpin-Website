import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

/**
 * Minimal SMTP server used to prove that the real nodemailer transport can
 * deliver a message: EHLO, STARTTLS, AUTH, MAIL/RCPT and DATA are implemented
 * just far enough for nodemailer's SMTP client.
 */

export interface SmtpSink {
  port: number;
  messages: string[];
  close: () => Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const certPath = path.join(here, '..', 'fixtures', 'smtp-test-cert.pem');
const keyPath = path.join(here, '..', 'fixtures', 'smtp-test-key.pem');

export async function startSmtpSink(): Promise<SmtpSink> {
  const secureContext = tls.createSecureContext({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  });
  const messages: string[] = [];
  const sockets = new Set<net.Socket>();
  let port = 0;

  const server = net.createServer((raw) => {
    sockets.add(raw);
    raw.on('close', () => sockets.delete(raw));
    attach(raw, false);
  });

  function attach(socket: net.Socket, alreadySecure: boolean) {
    let secure = alreadySecure;
    let buffer = '';
    let inData = false;
    let data = '';
    let loginStage = 0;

    const send = (line: string) => {
      if (!socket.destroyed) socket.write(`${line}\r\n`);
    };

    // A fresh connection starts with the banner; a STARTTLS upgrade continues
    // the same session, so the client sends EHLO without a second greeting.
    if (!alreadySecure) send('220 test-smtp ESMTP');

    const processLine = (line: string) => {
      if (inData) {
        if (line === '.') {
          inData = false;
          messages.push(data);
          data = '';
          send('250 2.0.0 Message accepted');
          return;
        }
        // SMTP dot-stuffing: a leading dot is removed from the body line.
        data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
        return;
      }

      const upper = line.toUpperCase();
      if (upper.startsWith('EHLO')) {
        send('250-test-smtp');
        if (!secure) send('250-STARTTLS');
        send('250-AUTH PLAIN LOGIN');
        send('250 SIZE 10485760');
        return;
      }
      if (upper.startsWith('HELO')) {
        send('250 test-smtp');
        return;
      }
      if (upper === 'STARTTLS') {
        send('220 2.0.0 Ready to start TLS');
        socket.removeAllListeners('data');
        socket.removeAllListeners('error');
        const upgraded = new tls.TLSSocket(socket, { isServer: true, secureContext });
        attach(upgraded, true);
        return;
      }
      if (upper.startsWith('AUTH PLAIN')) {
        send('235 2.7.0 Authentication successful');
        return;
      }
      if (upper === 'AUTH LOGIN') {
        loginStage = 1;
        send('334 VXNlcm5hbWU6');
        return;
      }
      if (loginStage === 1) {
        loginStage = 2;
        send('334 UGFzc3dvcmQ6');
        return;
      }
      if (loginStage === 2) {
        loginStage = 0;
        send('235 2.7.0 Authentication successful');
        return;
      }
      if (upper.startsWith('MAIL FROM') || upper.startsWith('RCPT TO') || upper === 'RSET' || upper === 'NOOP') {
        send('250 2.1.0 OK');
        return;
      }
      if (upper === 'DATA') {
        inData = true;
        data = '';
        send('354 End data with <CR><LF>.<CR><LF>');
        return;
      }
      if (upper === 'QUIT') {
        send('221 2.0.0 Bye');
        socket.end();
        return;
      }
      send('250 OK');
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\r\n');
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        processLine(line);
        index = buffer.indexOf('\r\n');
      }
    });
    socket.on('error', () => undefined);
  }

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') port = address.port;
      resolve();
    });
  });

  return {
    port,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
