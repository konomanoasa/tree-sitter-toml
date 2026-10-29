#include "tree_sitter/parser.h"

enum TokenType {
  MLB_QUOTE,
  MLL_QUOTE,
  TIME_HOUR_START,
  DATE_SPACE,
  BASIC_UNESCAPED,
  LITERAL_CHAR,
  COMMENT,
  CONTINUATION_SPACE,
  ERROR_SENTINEL,
  TOKEN_COUNT
};

static bool is_text(int32_t c) {
  return c == '\t' ||
    (c >= 0x20 && c != 0x7f && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff));
}

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
  const bool *valid
) {
  (void)payload;
  if (valid[ERROR_SENTINEL]) return false;
  const int32_t c = lexer->lookahead;
  if (valid[CONTINUATION_SPACE] && (c == ' ' || c == '\t')) {
    do {
      lexer->advance(lexer, false);
    } while (lexer->lookahead == ' ' || lexer->lookahead == '\t');
    lexer->mark_end(lexer);
    lexer->result_symbol = CONTINUATION_SPACE;
    return true;
  }
  if (valid[COMMENT] && c == '#') {
    do {
      lexer->advance(lexer, false);
    } while (!lexer->eof(lexer) && is_text(lexer->lookahead));
    lexer->mark_end(lexer);
    lexer->result_symbol = COMMENT;
    return true;
  }
  if (
    is_text(c) &&
    ((valid[BASIC_UNESCAPED] && c != '"' && c != '\\') ||
      (valid[LITERAL_CHAR] && c != '\''))
  ) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = valid[BASIC_UNESCAPED] && c != '"' && c != '\\'
      ? BASIC_UNESCAPED
      : LITERAL_CHAR;
    return true;
  }
  if (
    valid[TIME_HOUR_START] || (valid[DATE_SPACE] && lexer->lookahead == ' ')
  ) {
    const bool space = valid[DATE_SPACE] && lexer->lookahead == ' ';
    if (space) lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    const int32_t first = lexer->lookahead;
    if (first < '0' || first > '2') return false;
    lexer->advance(lexer, false);
    const int32_t second = lexer->lookahead;
    if (second < '0' || second > (first == '2' ? '3' : '9')) return false;
    lexer->advance(lexer, false);
    if (lexer->lookahead != ':') return false;
    lexer->result_symbol = space ? DATE_SPACE : TIME_HOUR_START;
    return true;
  }
  const int32_t quote = lexer->lookahead;
  const enum TokenType symbol = quote == '"' ? MLB_QUOTE : MLL_QUOTE;
  if ((quote != '"' && quote != '\'') || !valid[symbol]) return false;
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  unsigned count = 1;
  while (lexer->lookahead == quote && count < 5) {
    lexer->advance(lexer, false);
    count++;
  }
  if (count == 3) return false;
  lexer->result_symbol = symbol;
  return true;
}
