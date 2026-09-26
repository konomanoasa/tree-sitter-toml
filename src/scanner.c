#include "tree_sitter/parser.h"

enum TokenType { MLB_QUOTE, MLL_QUOTE, TOKEN_COUNT };

void *tree_sitter_toml_external_scanner_create(void) {
  return NULL;
}

void tree_sitter_toml_external_scanner_destroy(void *payload) {
  (void)payload;
}

unsigned
tree_sitter_toml_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}

void tree_sitter_toml_external_scanner_deserialize(
  void *payload,
  const char *buffer,
  unsigned length
) {
  (void)payload;
  (void)buffer;
  (void)length;
}

bool tree_sitter_toml_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  (void)payload;
  const int32_t quote = lexer->lookahead;
  if (quote != '"' && quote != '\'') {
    return false;
  }
  // Error recovery marks both quote tokens valid; the delimiter selects one.
  const enum TokenType symbol = quote == '"' ? MLB_QUOTE : MLL_QUOTE;
  if (!valid_symbols[symbol]) {
    return false;
  }
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  unsigned count = 1;
  while (lexer->lookahead == quote && count < 6) {
    lexer->advance(lexer, false);
    count++;
  }
  if (count == 3 || count == 6) {
    return false;
  }
  lexer->result_symbol = symbol;
  return true;
}
