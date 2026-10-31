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
  DATE_FULLYEAR_START,
  KEY_DOT,
  TOKEN_COUNT
};

static bool is_text(int32_t c) {
  return c == '\t' ||
    (c >= 0x20 && c != 0x7f && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff));
}

static bool mark(TSLexer *lexer, enum TokenType symbol) {
  lexer->mark_end(lexer);
  lexer->result_symbol = symbol;
  return true;
}

static bool mark_before_date_time(TSLexer *lexer, const bool *valid) {
  lexer->mark_end(lexer);
  unsigned value = 0;
  for (unsigned i = 0; i < 4; i++) {
    if (lexer->lookahead < '0' || lexer->lookahead > '9') return false;
    value = value * 10 + (unsigned)(lexer->lookahead - '0');
    lexer->advance(lexer, false);
    if (i == 1) {
      if (
        lexer->lookahead == ':' &&
        value <= 23 &&
        (valid[TIME_HOUR_START] || valid[DATE_SPACE])
      ) {
        lexer->result_symbol = valid[DATE_SPACE] ? DATE_SPACE : TIME_HOUR_START;
        return true;
      }
      if (!valid[DATE_FULLYEAR_START]) return false;
    }
  }
  if (lexer->lookahead != '-') return false;
  lexer->advance(lexer, false);
  lexer->result_symbol = DATE_FULLYEAR_START;
  return true;
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
  if (valid[KEY_DOT]) {
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t')
      lexer->advance(lexer, true);
    if (lexer->lookahead != '.') return false;
    lexer->advance(lexer, false);
    return mark(lexer, KEY_DOT);
  }
  const int32_t c = lexer->lookahead;
  if (valid[CONTINUATION_SPACE] && (c == ' ' || c == '\t')) {
    do {
      lexer->advance(lexer, false);
    } while (lexer->lookahead == ' ' || lexer->lookahead == '\t');
    return mark(lexer, CONTINUATION_SPACE);
  }
  if (valid[COMMENT] && c == '#') {
    do {
      lexer->advance(lexer, false);
    } while (!lexer->eof(lexer) && is_text(lexer->lookahead));
    return mark(lexer, COMMENT);
  }
  if (valid[BASIC_UNESCAPED] && is_text(c) && c != '"' && c != '\\') {
    lexer->advance(lexer, false);
    return mark(lexer, BASIC_UNESCAPED);
  }
  if (valid[LITERAL_CHAR] && is_text(c) && c != '\'') {
    lexer->advance(lexer, false);
    return mark(lexer, LITERAL_CHAR);
  }
  if (valid[DATE_SPACE] && c == ' ') {
    lexer->advance(lexer, false);
    return mark_before_date_time(lexer, valid);
  }
  if (valid[TIME_HOUR_START] || valid[DATE_FULLYEAR_START])
    return mark_before_date_time(lexer, valid);
  const enum TokenType symbol = c == '"' ? MLB_QUOTE : MLL_QUOTE;
  if ((c != '"' && c != '\'') || !valid[symbol]) return false;
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  unsigned count = 1;
  while (lexer->lookahead == c && count < 5) {
    lexer->advance(lexer, false);
    count++;
  }
  if (count == 3) return false;
  lexer->result_symbol = symbol;
  return true;
}
