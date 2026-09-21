# tree-sitter-toml

[![CI](https://github.com/konomanoasa/tree-sitter-toml/actions/workflows/ci.yaml/badge.svg)](https://github.com/konomanoasa/tree-sitter-toml/actions/workflows/ci.yaml)
[![npm](https://img.shields.io/npm/v/@konomanoasa/tree-sitter-toml)](https://www.npmjs.com/package/@konomanoasa/tree-sitter-toml)

[Tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for
Tom's Obvious Minimal Language 1.1.0.

## Installation

```sh
npm install @konomanoasa/tree-sitter-toml
```

## Grammar

| Grammar | Description | Rust constant |
| --- | --- | --- |
| `toml` | TOML 1.1.0 | `LANGUAGE` |

## Development

Development requires Node.js 24.2.0 or later.

```sh
npm install
npm run build
npm test
```

## Specifications

- [TOML 1.1.0](https://toml.io/en/v1.1.0)
- [TOML 1.1.0 ABNF](https://github.com/toml-lang/toml/blob/1.1.0/toml.abnf)

## License

[MIT](LICENSE)
