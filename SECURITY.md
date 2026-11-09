# Security

## What to expect

LAN Militia is a local-network party game. Its threat model is simple:

- There are no accounts or passwords. **Anyone on the same network can join** while the server is running.
- The server only serves its own game files and accepts game messages. It doesn't read or write other files.
- It listens on all network interfaces. Run it on a trusted home network or hotspot, and **don't forward the port to the internet**.

## Reporting a vulnerability

Please report security issues privately through [GitHub's private vulnerability reporting](https://github.com/sainad2222/lan-militia/security/advisories/new), not in a public issue.

Include what you found, how to reproduce it, and the version or commit. You should hear back within a week.

## Supported versions

Only the latest release gets fixes.
