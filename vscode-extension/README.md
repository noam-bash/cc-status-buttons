# CC Status Buttons — VS Code transport

Companion extension for [cc-status-buttons](https://github.com/noam-bash/cc-status-buttons). It receives `vscode://noam-bash.cc-status-buttons/press/<id>?t=<token>` clicks from the integrated terminal, validates the token against `~/.claude/status-buttons.json`, and runs the registered button command — no browser involved.

Install from the packaged `.vsix`:

```
code --install-extension cc-status-buttons-0.1.0.vsix
```

On first activation it flags the `vscode` transport in the registry, and status line buttons rendered inside VS Code terminals switch to silent `vscode://` links automatically.
