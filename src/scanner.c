#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"

enum TokenType {
  MLB_QUOTE,
  MLL_QUOTE,
  INTEGER_START,
  FLOAT_START,
  DATE_START,
  DATE_SPACE,
  DATE_END,
  TIME_END,
  TIME_SECONDS_START,
  TIME_FRACTION_START,
  TIME_FRACTION_DIGITS_START,
  TIME_OFFSET_START,
  EXPONENT_START,
  FLOAT_FRACTION_START,
  EXPONENT_DIGITS_START,
  FRACTION_DIGITS_START,
  NUMERIC_PREFIX_DIGITS_START,
  SIGNED_EXPONENT_DIGITS_START,
  DEC_CONTINUATION,
  HEX_CONTINUATION,
  OCT_CONTINUATION,
  BIN_CONTINUATION,
  DEC_JUNK_START,
  HEX_JUNK_START,
  OCT_JUNK_START,
  BIN_JUNK_START,
  DEC_JUNK_CONTINUATION,
  HEX_JUNK_CONTINUATION,
  OCT_JUNK_CONTINUATION,
  BIN_JUNK_CONTINUATION,
  NUMBER_JUNK_END,
  INVALID_DEC_CONTINUATION,
  INVALID_HEX_CONTINUATION,
  INVALID_OCT_CONTINUATION,
  INVALID_BIN_CONTINUATION,
  NUMBER_END,
  UNEXPECTED_CHARACTER_START,
  UNEXPECTED_CHARACTER_CONTINUATION,
  DOT_SEPARATOR,
  EXPRESSION_END,
  ITEM_END,
  BLANK_LINE,
  BROKEN_COMMENT_START,
  COMMENT_END,
  DATE_ELEMENT_END,
  DATE_FULLYEAR_START,
  DATE_MONTH_START,
  DATE_MDAY_START,
  TIME_HOUR_START,
  TIME_MINUTE_START,
  TIME_SECOND_START,
  UNEXPECTED_VALUE,
  UNEXPECTED_CHARACTER,
  INVALID_ARRAY_TABLE_CLOSE,
  INCOMPLETE_ARRAY_TABLE_CLOSE,
  MISSING_DOTTED_KEY,
  UNEXPECTED_TIME_OFFSET,
  UNEXPECTED_TIME_FRACTION,
  INVALID_DEC_DIGIT,
  INVALID_HEX_DIGIT,
  INVALID_OCT_DIGIT,
  INVALID_BIN_DIGIT,
  LEADING_ZERO,
  LEADING_SEPARATOR,
  INVALID_DATE_MONTH,
  INCOMPLETE_DATE_MONTH,
  INVALID_DATE_MDAY,
  INCOMPLETE_DATE_MDAY,
  INVALID_TIME_HOUR,
  INCOMPLETE_TIME_HOUR,
  INVALID_TIME_MINUTE,
  INCOMPLETE_TIME_MINUTE,
  INVALID_TIME_SECOND,
  INCOMPLETE_TIME_SECOND,
  INCOMPLETE_NUMBER,
  INVALID_VALUE,
  INCOMPLETE_VALUE,
  INCOMPLETE_NUMERIC_VALUE,
  INVALID_SPECIAL_FLOAT,
  INCOMPLETE_SPECIAL_FLOAT,
  INVALID_KEY_CHARACTER,
  MISSING_PAIR_KEY,
  INVALID_MISSING_DATE_SEPARATOR,
  INCOMPLETE_MISSING_DATE_SEPARATOR,
  INVALID_MISSING_TIME_SEPARATOR,
  INCOMPLETE_MISSING_TIME_SEPARATOR,
  INVALID_MISSING_DIGITS,
  INCOMPLETE_MISSING_DIGITS,
  INVALID_MISSING_KEY,
  INCOMPLETE_MISSING_KEY,
  INVALID_MISSING_ASSIGNMENT_OPERATOR,
  INCOMPLETE_MISSING_ASSIGNMENT_OPERATOR,
  INVALID_MISSING_VALUE,
  INCOMPLETE_MISSING_VALUE,
  INVALID_MISSING_BASIC_STRING_CLOSE,
  INCOMPLETE_MISSING_BASIC_STRING_CLOSE,
  INVALID_MISSING_LITERAL_STRING_CLOSE,
  INCOMPLETE_MISSING_LITERAL_STRING_CLOSE,
  INVALID_MISSING_ARRAY_CLOSE,
  INCOMPLETE_MISSING_ARRAY_CLOSE,
  INVALID_MISSING_INLINE_TABLE_CLOSE,
  INCOMPLETE_MISSING_INLINE_TABLE_CLOSE,
  INVALID_MISSING_STD_TABLE_CLOSE,
  INCOMPLETE_MISSING_STD_TABLE_CLOSE,
  INVALID_MISSING_ARRAY_TABLE_CLOSE,
  INCOMPLETE_MISSING_ARRAY_TABLE_CLOSE,
  MISSING_ML_BASIC_STRING_CLOSE,
  MISSING_ML_LITERAL_STRING_CLOSE,
  MISSING_ARRAY_SEPARATOR,
  MISSING_INLINE_TABLE_SEPARATOR,
  MISSING_NEWLINE,
  INVALID_ESCAPE,
  INCOMPLETE_ESCAPE,
  INVALID_CHARACTER,
  INVALID_LINE_ENDING,
  INCOMPLETE_LINE_ENDING,
  INVALID_ENCODING,
  INVALID_DEC_ENCODING,
  INVALID_HEX_ENCODING,
  INVALID_OCT_ENCODING,
  INVALID_BIN_ENCODING,
  INVALID_UNICODE_ESCAPE,
  UNEXPECTED_ENCODING,
  STRAY_CLOSE,
  ESCAPE_PREFIX,
  ERROR_SENTINEL,
  ARRAY_OPEN,
  ARRAY_CLOSE,
  INLINE_TABLE_OPEN,
  INLINE_TABLE_CLOSE,
  TOKEN_COUNT
};

enum RejectedKey {
  NO_REJECTED_KEY,
  REJECTED_KEY,
  REJECTED_DOT,
  REJECTED_KEY_CONTINUATION
};

struct Scanner {
  enum RejectedKey rejected_key;
  // Key lookahead must not reclassify an invalid word as an exponent.
  bool word_continuation;
  uint32_t arrays;
  uint32_t inline_tables;
};

enum Base { DEC, HEX, OCT, BIN, NO_BASE };

static const struct {
  enum TokenType start;
  enum TokenType invalid;
  unsigned minimum;
  unsigned maximum;
} date_elements[] = {
  {DATE_MONTH_START, INVALID_DATE_MONTH, 1, 12},
  {DATE_MDAY_START, INVALID_DATE_MDAY, 1, 31},
  {TIME_HOUR_START, INVALID_TIME_HOUR, 0, 23},
  {TIME_MINUTE_START, INVALID_TIME_MINUTE, 0, 59},
  {TIME_SECOND_START, INVALID_TIME_SECOND, 0, 60},
};

static bool is_space(int32_t c) {
  return c == ' ' || c == '\t';
}

static bool is_newline(int32_t c) {
  return c == '\r' || c == '\n';
}

static bool is_control(int32_t c) {
  return (c >= 0 && c < 0x20 && !is_space(c) && !is_newline(c)) || c == 0x7f;
}

static bool is_comment_char(int32_t c) {
  return c == '\t' || (c >= 0x20 && c != 0x7f);
}

static bool is_digit(int32_t c) {
  return c >= '0' && c <= '9';
}

static bool is_hex_digit(int32_t c) {
  return is_digit(c) || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f');
}

static bool is_base_digit(int32_t c, enum Base base) {
  if (base == HEX) return is_hex_digit(c);
  return c >= '0' && c <= (base == OCT ? '7' : base == BIN ? '1' : '9');
}

static bool is_key_char(int32_t c) {
  return (c >= 'A' && c <= 'Z') ||
    (c >= 'a' && c <= 'z') ||
    is_digit(c) ||
    c == '_' ||
    c == '-';
}

static bool is_scalar_boundary(int32_t c) {
  return is_space(c) ||
    is_newline(c) ||
    c == '#' ||
    c == ',' ||
    c == '[' ||
    c == ']' ||
    c == '{' ||
    c == '}' ||
    c == '"' ||
    c == '\'';
}

static bool is_invalid_key_char(int32_t c) {
  return c != -1 &&
    !is_key_char(c) &&
    !is_scalar_boundary(c) &&
    c != '.' &&
    c != '=';
}

static bool is_invalid_number_char(int32_t c, enum Base base) {
  return c != -1 &&
    !is_scalar_boundary(c) &&
    !is_base_digit(c, base) &&
    c != '_' &&
    (base != DEC || c != '.');
}

static enum TokenType base_token(enum TokenType decimal, enum Base base) {
  return (enum TokenType)(decimal + base);
}

static enum Base active_base(const bool *valid) {
  for (enum Base base = DEC; base < NO_BASE; base++)
    if (
      valid[base_token(DEC_CONTINUATION, base)] ||
      valid[base_token(DEC_JUNK_CONTINUATION, base)] ||
      valid[base_token(INVALID_DEC_CONTINUATION, base)] ||
      valid[base_token(INVALID_DEC_DIGIT, base)]
    )
      return base;
  return NO_BASE;
}

static bool
valid_base_token(const bool *valid, enum TokenType decimal, enum Base base) {
  return base != NO_BASE && valid[base_token(decimal, base)];
}

static bool valid_date_element_start(const bool *valid) {
  return valid[DATE_FULLYEAR_START] ||
    valid[DATE_MONTH_START] ||
    valid[DATE_MDAY_START] ||
    valid[TIME_HOUR_START] ||
    valid[TIME_MINUTE_START] ||
    valid[TIME_SECOND_START];
}

static bool emit(TSLexer *lexer, const bool *valid, enum TokenType token) {
  if (!valid[token]) return false;
  lexer->result_symbol = token;
  // Include the final lookahead character in edit invalidation.
  if (!lexer->eof(lexer)) lexer->advance(lexer, false);
  return true;
}

// Paired issues place the incomplete token immediately after the invalid token.
static bool valid_issue(const bool *valid, enum TokenType invalid) {
  return valid[invalid] || valid[invalid + 1];
}

static bool emit_issue(
  TSLexer *lexer,
  const bool *valid,
  enum TokenType invalid,
  bool incomplete
) {
  return emit(lexer, valid, (enum TokenType)(invalid + (incomplete ? 1 : 0)));
}

static bool
emit_missing(TSLexer *lexer, const bool *valid, enum TokenType invalid) {
  return emit_issue(lexer, valid, invalid, lexer->eof(lexer));
}

static bool take(TSLexer *lexer, const bool *valid, enum TokenType token) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  return emit(lexer, valid, token);
}

static void skip_spaces(TSLexer *lexer) {
  while (is_space(lexer->lookahead)) lexer->advance(lexer, false);
}

static bool keyval_may_follow(const bool *valid) {
  return valid[EXPRESSION_END] || valid[MISSING_INLINE_TABLE_SEPARATOR];
}

static bool keyval_ahead(TSLexer *lexer, bool bare) {
  bool has_key = bare;
  for (;; bare = false) {
    const int32_t quote = lexer->lookahead;
    if (!bare && (quote == '"' || quote == '\'')) {
      lexer->advance(lexer, false);
      while (
        !lexer->eof(lexer) &&
        !is_newline(lexer->lookahead) &&
        lexer->lookahead != quote
      ) {
        if (quote == '"' && lexer->lookahead == '\\') {
          lexer->advance(lexer, false);
          if (lexer->eof(lexer) || is_newline(lexer->lookahead)) return false;
        }
        lexer->advance(lexer, false);
      }
      if (lexer->eof(lexer) || lexer->lookahead != quote) return false;
      lexer->advance(lexer, false);
      has_key = true;
    } else {
      while (is_key_char(lexer->lookahead)) {
        has_key = true;
        lexer->advance(lexer, false);
      }
    }
    skip_spaces(lexer);
    if (lexer->lookahead == '=') return has_key;
    if (lexer->lookahead != '.') return false;
    lexer->advance(lexer, false);
    skip_spaces(lexer);
  }
}

// Consume rejected key chains once to avoid repeated suffix lookahead.
static enum RejectedKey take_rejected_keys(TSLexer *lexer) {
  enum RejectedKey next = REJECTED_KEY;
  for (bool first = true;; first = false) {
    const int32_t quote = lexer->lookahead;
    if (quote == '"' || quote == '\'') {
      lexer->advance(lexer, false);
      if (first) lexer->mark_end(lexer);
      while (lexer->lookahead != quote) {
        if (quote == '"' && lexer->lookahead == '\\')
          lexer->advance(lexer, false);
        if (
          lexer->eof(lexer) ||
          is_newline(lexer->lookahead) ||
          lexer->lookahead == -1
        )
          return NO_REJECTED_KEY;
        lexer->advance(lexer, false);
      }
      lexer->advance(lexer, false);
    } else if (is_key_char(quote)) {
      while (is_key_char(lexer->lookahead)) lexer->advance(lexer, false);
    } else {
      return next;
    }
    next = REJECTED_DOT;
    lexer->mark_end(lexer);
    if (lexer->lookahead != '.') return next;
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    next = REJECTED_KEY;
  }
}

static bool adjacent_keyval(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  bool bare
) {
  if (!keyval_may_follow(valid)) return false;
  if (scanner->rejected_key != NO_REJECTED_KEY) return false;
  if (keyval_ahead(lexer, bare)) return true;
  scanner->rejected_key = REJECTED_KEY_CONTINUATION;
  return false;
}

static bool end_before_keyval(TSLexer *lexer, const bool *valid) {
  return emit(lexer, valid, EXPRESSION_END) || emit(lexer, valid, ITEM_END);
}

static void
continue_rejected_key(struct Scanner *scanner, int32_t c, bool spaced) {
  if (scanner->rejected_key == REJECTED_KEY && is_key_char(c))
    scanner->rejected_key = REJECTED_KEY_CONTINUATION;
  else if (
    (
      scanner->rejected_key == REJECTED_KEY && c != '.' && c != '"' && c != '\''
    ) ||
    (scanner->rejected_key == REJECTED_DOT && c != '.') ||
    (scanner->rejected_key == REJECTED_KEY_CONTINUATION &&
      c != '.' &&
      (spaced || !is_key_char(c)))
  )
    scanner->rejected_key = NO_REJECTED_KEY;
}

static void resume_rejected_key(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  bool value_start,
  bool numeric
) {
  if (
    (!valid[UNEXPECTED_CHARACTER_CONTINUATION] &&
      !valid[UNEXPECTED_CHARACTER] &&
      !numeric) ||
    value_start ||
    is_newline(lexer->lookahead) ||
    lexer->eof(lexer) ||
    lexer->is_at_included_range_start(lexer)
  )
    scanner->rejected_key = NO_REJECTED_KEY;
  if (!is_space(lexer->lookahead))
    continue_rejected_key(scanner, lexer->lookahead, false);
}

// Clear finished chains before zero-width tokens to preserve subtree reuse.
static void end_rejected_chain(struct Scanner *scanner, TSLexer *lexer) {
  const enum RejectedKey rejected = scanner->rejected_key;
  if (rejected == NO_REJECTED_KEY) return;
  bool spaced = false;
  while (is_space(lexer->lookahead)) {
    lexer->advance(lexer, false);
    spaced = true;
  }
  continue_rejected_key(scanner, lexer->lookahead, spaced);
  if (scanner->rejected_key != NO_REJECTED_KEY)
    scanner->rejected_key = rejected;
}

static void end_rejected_digit_chain(
  struct Scanner *scanner,
  TSLexer *lexer,
  enum Base base
) {
  if (scanner->rejected_key == NO_REJECTED_KEY) return;
  if (lexer->lookahead == '_') lexer->advance(lexer, false);
  if (!is_base_digit(lexer->lookahead, base)) return;
  lexer->advance(lexer, false);
  end_rejected_chain(scanner, lexer);
}

static bool emit_element_start(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  enum TokenType token
) {
  if (!emit(lexer, valid, token)) return false;
  scanner->rejected_key = NO_REJECTED_KEY;
  return true;
}

static bool take_invalid_characters(
  TSLexer *lexer,
  const bool *valid,
  enum TokenType token
) {
  do {
    lexer->advance(lexer, false);
  } while (
    !lexer->eof(lexer) &&
    (token == INVALID_KEY_CHARACTER ? is_invalid_key_char(lexer->lookahead)
                                    : is_control(lexer->lookahead))
  );
  lexer->mark_end(lexer);
  return emit(lexer, valid, token);
}

static bool
take_encoding(TSLexer *lexer, const bool *valid, enum TokenType token) {
  do {
    lexer->advance(lexer, false);
  } while (!lexer->eof(lexer) && lexer->lookahead == -1);
  lexer->mark_end(lexer);
  return emit(lexer, valid, token);
}

static bool scan_decoding_failure(
  TSLexer *lexer,
  const bool *valid,
  enum Base base,
  bool trailing_junk
) {
  if (valid_base_token(valid, INVALID_DEC_ENCODING, base))
    return take_encoding(lexer, valid, base_token(INVALID_DEC_ENCODING, base));
  const enum TokenType token = valid[UNEXPECTED_ENCODING] || trailing_junk
    ? UNEXPECTED_ENCODING
    : INVALID_ENCODING;
  return valid[token] && take_encoding(lexer, valid, token);
}

static bool scan_broken_comment(TSLexer *lexer, const bool *valid) {
  bool invalid = false;
  while (!lexer->eof(lexer) && !is_newline(lexer->lookahead)) {
    if (!is_comment_char(lexer->lookahead)) invalid = true;
    lexer->advance(lexer, false);
  }
  return invalid && emit(lexer, valid, BROKEN_COMMENT_START);
}

static bool scan_comment_body(TSLexer *lexer, const bool *valid, int32_t c) {
  if (c == -1)
    return valid[INVALID_ENCODING] &&
      take_encoding(lexer, valid, INVALID_ENCODING);
  if (lexer->eof(lexer) || is_newline(c))
    return emit(lexer, valid, COMMENT_END);
  return !is_comment_char(c) &&
    valid[INVALID_CHARACTER] &&
    take_invalid_characters(lexer, valid, INVALID_CHARACTER);
}

static bool scan_blank_line(TSLexer *lexer, const bool *valid) {
  skip_spaces(lexer);
  if (!is_newline(lexer->lookahead) && !lexer->eof(lexer)) return false;
  lexer->mark_end(lexer);
  return emit(lexer, valid, BLANK_LINE);
}

static bool scan_carriage_return(TSLexer *lexer, const bool *valid) {
  lexer->advance(lexer, false);
  if (lexer->lookahead == '\n') return false;
  lexer->mark_end(lexer);
  return emit_issue(lexer, valid, INVALID_LINE_ENDING, lexer->eof(lexer));
}

static bool
scan_hex_escape(TSLexer *lexer, const bool *valid, unsigned remaining) {
  uint32_t value = 0;
  lexer->advance(lexer, false);
  while (remaining && is_hex_digit(lexer->lookahead)) {
    const int32_t digit = lexer->lookahead;
    value = value * 16 +
      (uint32_t)(digit <= '9' ? digit - '0' : (digit | 32) - 'a' + 10);
    lexer->advance(lexer, false);
    remaining--;
  }
  if (!remaining)
    return (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) &&
      emit(lexer, valid, INVALID_UNICODE_ESCAPE);
  const uint64_t lower = (uint64_t)value << (remaining * 4);
  const uint64_t upper = lower | ((UINT64_C(1) << (remaining * 4)) - 1);
  const bool completable =
    lower <= 0x10ffff && !(lower >= 0xd800 && upper <= 0xdfff);
  if (completable && lexer->lookahead == -1)
    return emit(lexer, valid, ESCAPE_PREFIX);
  lexer->mark_end(lexer);
  return emit_issue(
    lexer,
    valid,
    INVALID_ESCAPE,
    lexer->eof(lexer) && completable
  );
}

static bool scan_escape(TSLexer *lexer, const bool *valid) {
  lexer->advance(lexer, false);
  const int32_t c = lexer->lookahead;
  if (c == -1) return emit(lexer, valid, ESCAPE_PREFIX);
  if (
    c == '"' ||
    c == '\\' ||
    c == 'b' ||
    c == 'e' ||
    c == 'f' ||
    c == 'n' ||
    c == 'r' ||
    c == 't'
  )
    return false;
  if (c == 'x' || c == 'u' || c == 'U')
    return scan_hex_escape(lexer, valid, c == 'x' ? 2 : c == 'u' ? 4 : 8);
  bool appendable = lexer->eof(lexer);
  if (is_space(c) || is_newline(c)) {
    lexer->mark_end(lexer);
    if (valid[MISSING_ML_BASIC_STRING_CLOSE]) {
      skip_spaces(lexer);
      if (lexer->lookahead == '\n') return false;
      if (lexer->lookahead == '\r') {
        lexer->advance(lexer, false);
        if (lexer->lookahead == '\n') return false;
      }
      if (lexer->eof(lexer)) {
        lexer->mark_end(lexer);
        appendable = true;
      }
    }
  } else {
    if (!lexer->eof(lexer)) lexer->advance(lexer, false);
    lexer->mark_end(lexer);
  }
  return emit_issue(lexer, valid, INVALID_ESCAPE, appendable);
}

static bool scan_quote(TSLexer *lexer, const bool *valid, int32_t quote) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  unsigned count = 1;
  while (lexer->lookahead == quote && count < 5) {
    lexer->advance(lexer, false);
    count++;
  }
  if (count == 3) return false;
  return emit(lexer, valid, quote == '"' ? MLB_QUOTE : MLL_QUOTE);
}

static bool in_string_body(const bool *valid) {
  return valid_issue(valid, INVALID_ESCAPE) ||
    valid[ESCAPE_PREFIX] ||
    valid[INVALID_UNICODE_ESCAPE] ||
    valid[MLB_QUOTE] ||
    valid[MLL_QUOTE] ||
    valid_issue(valid, INVALID_MISSING_BASIC_STRING_CLOSE) ||
    valid_issue(valid, INVALID_MISSING_LITERAL_STRING_CLOSE) ||
    valid[MISSING_ML_BASIC_STRING_CLOSE] ||
    valid[MISSING_ML_LITERAL_STRING_CLOSE];
}

static bool scan_string_body(TSLexer *lexer, const bool *valid, int32_t c) {
  if (c == -1)
    return valid[INVALID_ENCODING] &&
      take_encoding(lexer, valid, INVALID_ENCODING);
  if (!lexer->eof(lexer) && is_control(c))
    return valid[INVALID_CHARACTER] &&
      take_invalid_characters(lexer, valid, INVALID_CHARACTER);
  if (c == '\\' && valid_issue(valid, INVALID_ESCAPE))
    return scan_escape(lexer, valid);
  if ((c == '"' && valid[MLB_QUOTE]) || (c == '\'' && valid[MLL_QUOTE]))
    return scan_quote(lexer, valid, c);
  if (c == '\r' && valid[INVALID_LINE_ENDING])
    return scan_carriage_return(lexer, valid);
  if (
    (lexer->eof(lexer) || is_newline(c)) &&
    (emit_missing(lexer, valid, INVALID_MISSING_BASIC_STRING_CLOSE) ||
      emit_missing(lexer, valid, INVALID_MISSING_LITERAL_STRING_CLOSE))
  )
    return true;
  return lexer->eof(lexer) &&
    (emit(lexer, valid, MISSING_ML_BASIC_STRING_CLOSE) ||
      emit(lexer, valid, MISSING_ML_LITERAL_STRING_CLOSE));
}

static enum TokenType value_start_token(bool date, bool floating) {
  return date ? DATE_START : floating ? FLOAT_START : INTEGER_START;
}

static bool scan_number_start(TSLexer *lexer, const bool *valid) {
  const int32_t first = lexer->lookahead;
  const bool sign = first == '+' || first == '-';
  bool radix = false, floating = first == '.', date = false;
  bool initial_digits = true, word = false, digit = false;
  unsigned length = 0;
  while (
    !lexer->eof(lexer) &&
    lexer->lookahead != -1 &&
    !is_scalar_boundary(lexer->lookahead)
  ) {
    const int32_t c = lexer->lookahead;
    const bool special = sign && length == 1 && (c == 'i' || c == 'n');
    if (length == 1 && first == '0' && (c == 'x' || c == 'o' || c == 'b'))
      radix = true;
    if (
      !radix &&
      length > 0 &&
      ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) &&
      !special &&
      !(date && (c == 'T' || c == 't' || c == 'Z' || c == 'z'))
    ) {
      const bool assignment =
        (valid[INVALID_MISSING_VALUE] || keyval_may_follow(valid)) &&
        keyval_ahead(lexer, false);
      if (
        !assignment && (c == 'e' || c == 'E') && !word && (digit || length == 1)
      )
        floating = true;
      return emit(lexer, valid, value_start_token(date, floating));
    }
    if (!radix && (c == '.' || special)) floating = true;
    if (initial_digits && length > 0 && (c == ':' || (length == 4 && c == '-')))
      date = true;
    if (!is_digit(c)) initial_digits = false;
    else digit = true;
    if (is_digit(c) || c == '.') word = false;
    else if (length > 0 && c != '_') word = word || is_key_char(c);
    lexer->advance(lexer, false);
    if (length < 5) length++;
  }
  if (
    first == '0' &&
    initial_digits &&
    length >= 2 &&
    length <= 4 &&
    lexer->eof(lexer)
  )
    return emit(lexer, valid, INCOMPLETE_NUMERIC_VALUE);
  return emit(lexer, valid, value_start_token(date, floating));
}

static bool scan_word_value(TSLexer *lexer, const bool *valid) {
  const int32_t first = lexer->lookahead;
  const char *const word = first == 't' ? "true"
    : first == 'f'                      ? "false"
    : first == 'i'                      ? "inf"
    : first == 'n'                      ? "nan"
                                        : "";
  unsigned position = 0;
  bool prefix = word[0] != '\0';
  while (
    !lexer->eof(lexer) &&
    lexer->lookahead != -1 &&
    !is_scalar_boundary(lexer->lookahead)
  ) {
    if (!word[position] || lexer->lookahead != word[position]) prefix = false;
    if (word[position]) position++;
    lexer->advance(lexer, false);
    if (prefix && !word[position])
      return first == 'i' || first == 'n' ? emit(lexer, valid, FLOAT_START)
                                          : false;
  }
  lexer->mark_end(lexer);
  const bool incomplete = prefix && lexer->eof(lexer);
  return emit_issue(
    lexer,
    valid,
    valid[INVALID_SPECIAL_FLOAT] ? INVALID_SPECIAL_FLOAT : INVALID_VALUE,
    incomplete
  );
}

static bool scan_value_start(TSLexer *lexer, const bool *valid) {
  const int32_t c = lexer->lookahead;
  if (is_digit(c) || c == '+' || c == '-' || c == '.')
    return scan_number_start(lexer, valid);
  return scan_word_value(lexer, valid);
}

static bool scan_digits_marker(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  enum Base base,
  int32_t c
) {
  if (valid[NUMERIC_PREFIX_DIGITS_START] && is_base_digit(c, base)) {
    end_rejected_digit_chain(scanner, lexer, base);
    return emit(lexer, valid, NUMERIC_PREFIX_DIGITS_START);
  }
  if (lexer->eof(lexer) || is_scalar_boundary(c)) return false;
  if (valid[FRACTION_DIGITS_START] && c != 'e' && c != 'E')
    return emit(lexer, valid, FRACTION_DIGITS_START);
  if (valid[SIGNED_EXPONENT_DIGITS_START])
    return emit(lexer, valid, SIGNED_EXPONENT_DIGITS_START);
  return valid[EXPONENT_DIGITS_START] &&
    c != '+' &&
    c != '-' &&
    emit(lexer, valid, EXPONENT_DIGITS_START);
}

static void take_number_junk(
  struct Scanner *scanner,
  TSLexer *lexer,
  enum Base base,
  bool word
) {
  bool previous_key = word;
  scanner->word_continuation = false;
  while (!lexer->eof(lexer)) {
    const int32_t c = lexer->lookahead;
    if (
      is_key_char(c) &&
      !is_base_digit(c, base) &&
      c != '_' &&
      (!word || !previous_key)
    ) {
      scanner->word_continuation =
        word && base == DEC && (c == 'e' || c == 'E');
      break;
    }
    previous_key = is_key_char(c);
    if (c == '_') {
      if (scanner->rejected_key != NO_REJECTED_KEY)
        scanner->rejected_key = REJECTED_KEY_CONTINUATION;
      lexer->advance(lexer, false);
      if (is_base_digit(lexer->lookahead, base)) break;
    } else if (is_invalid_number_char(c, base)) {
      if (scanner->rejected_key != NO_REJECTED_KEY)
        scanner->rejected_key =
          is_key_char(c) ? REJECTED_KEY_CONTINUATION : NO_REJECTED_KEY;
      lexer->advance(lexer, false);
    } else {
      break;
    }
    lexer->mark_end(lexer);
  }
  end_rejected_chain(scanner, lexer);
}

static bool take_invalid_digits(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  enum Base base
) {
  const int32_t first = lexer->lookahead;
  if (scanner->rejected_key != NO_REJECTED_KEY)
    scanner->rejected_key =
      is_key_char(first) ? REJECTED_KEY_CONTINUATION : REJECTED_KEY;
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  take_number_junk(scanner, lexer, base, is_key_char(first) && first != '_');
  return emit(lexer, valid, base_token(INVALID_DEC_DIGIT, base));
}

static bool continue_invalid_digits(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  enum Base base,
  int32_t c
) {
  if (
    lexer->eof(lexer) ||
    c == -1 ||
    is_scalar_boundary(c) ||
    is_base_digit(c, base) ||
    (c == '_' && valid[base_token(DEC_CONTINUATION, base)])
  )
    return false;
  if (
    valid[NUMBER_END] &&
    is_key_char(c) &&
    adjacent_keyval(scanner, lexer, valid, false)
  ) {
    scanner->word_continuation = false;
    return emit(lexer, valid, NUMBER_END);
  }
  if (
    base == DEC &&
    ((c == '.' && valid[FLOAT_FRACTION_START]) ||
      ((c == 'e' || c == 'E') &&
        valid[EXPONENT_START] &&
        valid[NUMBER_END] &&
        !scanner->word_continuation))
  )
    return false;
  return emit(lexer, valid, base_token(INVALID_DEC_CONTINUATION, base));
}

static bool continue_number_junk(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  enum Base base,
  int32_t c
) {
  if (
    valid[NUMBER_END] &&
    is_key_char(c) &&
    !is_base_digit(c, base) &&
    c != '_' &&
    adjacent_keyval(scanner, lexer, valid, false)
  )
    return emit(lexer, valid, NUMBER_END);
  if (
    lexer->eof(lexer) ||
    (!is_key_char(c) && c != '.') ||
    (base == DEC && (c == 'e' || c == 'E') && valid[EXPONENT_START])
  )
    return emit(lexer, valid, NUMBER_JUNK_END);
  if (c == '_' || is_base_digit(c, base))
    end_rejected_digit_chain(scanner, lexer, base);
  return emit(lexer, valid, base_token(DEC_JUNK_CONTINUATION, base));
}

static bool continue_number(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  enum Base base,
  int32_t c
) {
  const enum TokenType continuation = base_token(DEC_CONTINUATION, base);
  if (c == '_') {
    lexer->advance(lexer, false);
    if (is_base_digit(lexer->lookahead, base)) {
      end_rejected_digit_chain(scanner, lexer, base);
      return emit(lexer, valid, continuation);
    }
  }
  // Keep key lookahead inside the number for reparsing.
  if (!is_base_digit(c, base) && is_key_char(c) && keyval_may_follow(valid)) {
    if (adjacent_keyval(scanner, lexer, valid, c == '_'))
      return emit(lexer, valid, NUMBER_END);
    if (
      !(base == DEC && (c == 'e' || c == 'E')) &&
      emit(lexer, valid, base_token(DEC_JUNK_START, base))
    )
      return true;
  }
  if (
    base == DEC &&
    (c == 'e' || c == 'E') &&
    emit_element_start(scanner, lexer, valid, EXPONENT_START)
  )
    return true;
  if (
    base == DEC &&
    c == '.' &&
    emit_element_start(scanner, lexer, valid, FLOAT_FRACTION_START)
  )
    return true;
  if (is_base_digit(c, base)) end_rejected_digit_chain(scanner, lexer, base);
  return emit(lexer, valid, continuation);
}

static bool scan_leading_zero(TSLexer *lexer, const bool *valid) {
  lexer->advance(lexer, false);
  while (lexer->lookahead == '_') lexer->advance(lexer, false);
  return is_digit(lexer->lookahead) && emit(lexer, valid, LEADING_ZERO);
}

static bool take_leading_separator(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  enum Base base
) {
  do {
    lexer->advance(lexer, false);
  } while (lexer->lookahead == '_');
  lexer->mark_end(lexer);
  take_number_junk(scanner, lexer, base, false);
  return emit(lexer, valid, LEADING_SEPARATOR);
}

static bool take_separator_run(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  enum Base base
) {
  const enum TokenType invalid = base_token(INVALID_DEC_DIGIT, base);
  unsigned count = 0;
  do {
    lexer->advance(lexer, false);
    count++;
    if (is_base_digit(lexer->lookahead, base))
      return count > 1 && emit(lexer, valid, invalid);
    lexer->mark_end(lexer);
  } while (lexer->lookahead == '_');
  const bool incomplete = count == 1 && lexer->eof(lexer);
  take_number_junk(scanner, lexer, base, false);
  return emit(lexer, valid, incomplete ? INCOMPLETE_NUMBER : invalid);
}

static bool scan_date_element(TSLexer *lexer, const bool *valid) {
  unsigned count = 0, value = 0;
  while (is_digit(lexer->lookahead)) {
    if (count < 5) {
      value = value * 10 + (unsigned)(lexer->lookahead - '0');
      count++;
    }
    lexer->advance(lexer, false);
  }
  if (
    valid[DATE_FULLYEAR_START] &&
    !(valid[TIME_HOUR_START] && lexer->lookahead == ':')
  )
    return count == 4 && emit(lexer, valid, DATE_FULLYEAR_START);
  unsigned index = 0;
  while (!valid[date_elements[index].start]) index++;
  const unsigned minimum = date_elements[index].minimum;
  const unsigned maximum = date_elements[index].maximum;
  if (count == 2 && value >= minimum && value <= maximum)
    return emit(lexer, valid, date_elements[index].start);
  unsigned lower = value, upper = value;
  for (unsigned i = count; i < 2; i++) {
    lower *= 10;
    upper = upper * 10 + 9;
  }
  const bool incomplete =
    count < 2 && lexer->eof(lexer) && lower <= maximum && upper >= minimum;
  return emit_issue(lexer, valid, date_elements[index].invalid, incomplete);
}

static bool scan_date_end(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  int32_t c
) {
  if (c == 'T' || c == 't')
    return adjacent_keyval(scanner, lexer, valid, false) &&
      emit(lexer, valid, DATE_END);
  if (c == ' ') {
    lexer->advance(lexer, false);
    unsigned count = 0;
    while (count < 2 && is_digit(lexer->lookahead)) {
      lexer->advance(lexer, false);
      count++;
    }
    if (
      (count == 2 && lexer->lookahead == ':') ||
      (count > 0 && lexer->eof(lexer))
    )
      return emit(lexer, valid, DATE_SPACE);
  }
  return emit(lexer, valid, DATE_END);
}

static bool scan_time_suffix(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  int32_t c
) {
  if (
    valid[TIME_END] &&
    (c == 'Z' || c == 'z' || c == '-') &&
    adjacent_keyval(scanner, lexer, valid, false)
  )
    return emit(lexer, valid, TIME_END);
  if (c == ':') return emit(lexer, valid, TIME_SECONDS_START);
  if (c == '.')
    return emit(lexer, valid, UNEXPECTED_TIME_FRACTION) ||
      emit(lexer, valid, TIME_FRACTION_START);
  if (c == 'Z' || c == 'z' || c == '+' || c == '-')
    return emit_element_start(scanner, lexer, valid, UNEXPECTED_TIME_OFFSET) ||
      emit_element_start(scanner, lexer, valid, TIME_OFFSET_START);
  return false;
}

static bool emit_missing_close(
  uint32_t *count,
  TSLexer *lexer,
  const bool *valid,
  enum TokenType token
) {
  if (!emit_missing(lexer, valid, token)) return false;
  if (*count) --*count;
  return true;
}

static bool take_close(
  uint32_t *count,
  TSLexer *lexer,
  const bool *valid,
  enum TokenType token
) {
  if (*count) --*count;
  return take(lexer, valid, token);
}

static bool take_open(
  uint32_t *count,
  TSLexer *lexer,
  const bool *valid,
  enum TokenType token
) {
  ++*count;
  return take(lexer, valid, token);
}

static bool take_stray_close(TSLexer *lexer, const bool *valid, int32_t c) {
  if (emit(lexer, valid, UNEXPECTED_CHARACTER_CONTINUATION)) return true;
  do {
    lexer->advance(lexer, false);
  } while (lexer->lookahead == c);
  lexer->mark_end(lexer);
  return emit(lexer, valid, STRAY_CLOSE);
}

static bool scan_missing_close(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  int32_t c,
  bool end
) {
  if (
    (end || c == '#' || c == '[' || c == '=') &&
    (emit_missing(lexer, valid, INVALID_MISSING_STD_TABLE_CLOSE) ||
      emit_missing(lexer, valid, INVALID_MISSING_ARRAY_TABLE_CLOSE))
  )
    return true;
  return lexer->eof(lexer) &&
    (emit_missing_close(
       &scanner->arrays,
       lexer,
       valid,
       INVALID_MISSING_ARRAY_CLOSE
     ) ||
      emit_missing_close(
        &scanner->inline_tables,
        lexer,
        valid,
        INVALID_MISSING_INLINE_TABLE_CLOSE
      ));
}

static bool scan_array_table_close(TSLexer *lexer, const bool *valid) {
  lexer->advance(lexer, false);
  if (lexer->lookahead == ']') return false;
  lexer->mark_end(lexer);
  return emit_issue(lexer, valid, INVALID_ARRAY_TABLE_CLOSE, lexer->eof(lexer));
}

static bool scan_missing_separator(
  TSLexer *lexer,
  const bool *valid,
  int32_t c,
  bool spaced
) {
  return emit(lexer, valid, MISSING_ARRAY_SEPARATOR) ||
    (((!valid[UNEXPECTED_CHARACTER_START] &&
        (spaced || !valid[UNEXPECTED_CHARACTER_CONTINUATION])) ||
       c == '[' ||
       c == '{') &&
      emit(lexer, valid, MISSING_INLINE_TABLE_SEPARATOR));
}

static bool starts_junk(
  const struct Scanner *scanner,
  const bool *valid,
  int32_t c,
  bool number_continuation
) {
  return (!scanner->arrays &&
           !scanner->inline_tables &&
           (c == ']' || c == '}' || c == ',')) ||
    c == ';' ||
    c == '.' ||
    c == '{' ||
    c == '\\' ||
    is_control(c) ||
    c == -1 ||
    (keyval_may_follow(valid) &&
      !number_continuation &&
      (c == '"' || c == '\'' || !is_scalar_boundary(c)));
}

static bool scan_junk_start(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  int32_t c,
  bool spaced
) {
  if (
    (is_key_char(c) || c == '"' || c == '\'' || c == '.') &&
    scanner->rejected_key == NO_REJECTED_KEY
  ) {
    if (keyval_ahead(lexer, false)) return end_before_keyval(lexer, valid);
    scanner->rejected_key =
      is_key_char(c) ? REJECTED_KEY_CONTINUATION : REJECTED_KEY;
  }
  return (!spaced &&
           c != -1 &&
           emit(lexer, valid, UNEXPECTED_CHARACTER_CONTINUATION)) ||
    emit(lexer, valid, UNEXPECTED_CHARACTER_START);
}

static bool take_unexpected_character(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  int32_t c
) {
  if (is_key_char(c) || c == '"' || c == '\'') {
    const enum RejectedKey next = take_rejected_keys(lexer);
    if (scanner->rejected_key != NO_REJECTED_KEY) scanner->rejected_key = next;
  } else {
    if (scanner->rejected_key != NO_REJECTED_KEY)
      scanner->rejected_key = REJECTED_KEY;
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
  }
  end_rejected_chain(scanner, lexer);
  return emit(lexer, valid, UNEXPECTED_CHARACTER);
}

void *tree_sitter_toml_external_scanner_create(void) {
  return ts_calloc(1, sizeof(struct Scanner));
}

void tree_sitter_toml_external_scanner_destroy(void *payload) {
  ts_free(payload);
}

unsigned
tree_sitter_toml_external_scanner_serialize(void *payload, char *buffer) {
  const struct Scanner *scanner = payload;
  if (
    scanner->rejected_key == NO_REJECTED_KEY &&
    !scanner->word_continuation &&
    !scanner->arrays &&
    !scanner->inline_tables
  )
    return 0;
  buffer[0] =
    (char)(scanner->rejected_key | (scanner->word_continuation ? 4 : 0));
  for (unsigned i = 0; i < 4; i++) {
    buffer[1 + i] = (char)(scanner->arrays >> (8 * i));
    buffer[5 + i] = (char)(scanner->inline_tables >> (8 * i));
  }
  return 9;
}

void tree_sitter_toml_external_scanner_deserialize(
  void *payload,
  const char *buffer,
  unsigned length
) {
  struct Scanner *scanner = payload;
  *scanner = (struct Scanner){0};
  if (length != 9) return;
  scanner->rejected_key = (enum RejectedKey)(buffer[0] & 3);
  scanner->word_continuation = (buffer[0] & 4) != 0;
  for (unsigned i = 0; i < 4; i++) {
    scanner->arrays |= (uint32_t)(uint8_t)buffer[1 + i] << (8 * i);
    scanner->inline_tables |= (uint32_t)(uint8_t)buffer[5 + i] << (8 * i);
  }
}

bool tree_sitter_toml_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid
) {
  struct Scanner *scanner = payload;
  if (valid[ERROR_SENTINEL]) return false;
  const enum Base base = active_base(valid);
  const bool value_start =
    valid[INTEGER_START] || valid[FLOAT_START] || valid[DATE_START];
  resume_rejected_key(scanner, lexer, valid, value_start, base != NO_BASE);
  int32_t c = lexer->lookahead;
  lexer->mark_end(lexer);
  if (in_string_body(valid)) return scan_string_body(lexer, valid, c);
  if (valid[COMMENT_END]) return scan_comment_body(lexer, valid, c);
  const bool trailing_junk = !value_start &&
    valid[INVALID_CHARACTER] &&
    valid[UNEXPECTED_CHARACTER_START];

  if (scan_digits_marker(scanner, lexer, valid, base, c)) return true;
  if (
    c == -1 &&
    !valid_base_token(valid, DEC_CONTINUATION, base) &&
    scan_decoding_failure(lexer, valid, base, trailing_junk)
  )
    return true;
  if (c == '#' && valid[BROKEN_COMMENT_START])
    return scan_broken_comment(lexer, valid);
  if (valid[BLANK_LINE] && is_space(c)) return scan_blank_line(lexer, valid);

  if (valid[DATE_ELEMENT_END])
    return !is_digit(c) && emit(lexer, valid, DATE_ELEMENT_END);
  if (c != '-' && valid_issue(valid, INVALID_MISSING_DATE_SEPARATOR))
    return emit_missing(lexer, valid, INVALID_MISSING_DATE_SEPARATOR);
  if (c != ':' && valid_issue(valid, INVALID_MISSING_TIME_SEPARATOR))
    return emit_missing(lexer, valid, INVALID_MISSING_TIME_SEPARATOR);
  if (
    !is_digit(c) &&
    (valid_date_element_start(valid) || valid[TIME_FRACTION_DIGITS_START]) &&
    valid_issue(valid, INVALID_MISSING_DIGITS)
  )
    return emit_missing(lexer, valid, INVALID_MISSING_DIGITS);
  if (is_digit(c) && emit(lexer, valid, TIME_FRACTION_DIGITS_START))
    return true;
  if (is_digit(c) && valid_date_element_start(valid))
    return scan_date_element(lexer, valid);
  if (valid[DATE_END]) return scan_date_end(scanner, lexer, valid, c);

  const bool radix_digits =
    base != DEC && valid_base_token(valid, INVALID_DEC_DIGIT, base);
  if (
    (lexer->eof(lexer) ||
      is_scalar_boundary(c) ||
      ((c == '.' || c == 'e' || c == 'E') && !radix_digits)) &&
    emit_missing(lexer, valid, INVALID_MISSING_DIGITS)
  )
    return true;
  if (c == '=') {
    if (valid[UNEXPECTED_CHARACTER_START] && emit(lexer, valid, NUMBER_END))
      return true;
    if (valid[INVALID_CHARACTER] && !trailing_junk)
      return take(lexer, valid, INVALID_CHARACTER);
  }
  if (
    valid_base_token(valid, INVALID_DEC_CONTINUATION, base) &&
    continue_invalid_digits(scanner, lexer, valid, base, c)
  )
    return true;
  scanner->word_continuation = false;
  if (valid_base_token(valid, DEC_JUNK_CONTINUATION, base))
    return continue_number_junk(scanner, lexer, valid, base, c);
  if (
    valid_base_token(valid, DEC_CONTINUATION, base) &&
    !lexer->eof(lexer) &&
    !is_scalar_boundary(c)
  )
    return continue_number(scanner, lexer, valid, base, c);

  if (!lexer->eof(lexer) && is_control(c)) {
    if (valid_base_token(valid, INVALID_DEC_DIGIT, base))
      return take_invalid_digits(scanner, lexer, valid, base);
    const enum TokenType token = valid[INVALID_KEY_CHARACTER]
      ? INVALID_KEY_CHARACTER
      : valid[INVALID_CHARACTER] && !trailing_junk ? INVALID_CHARACTER
                                                   : UNEXPECTED_CHARACTER;
    if (valid[token]) return take_invalid_characters(lexer, valid, token);
  }
  if (value_start) {
    if (c == '"' || c == '\'') return false;
    if (!lexer->eof(lexer) && !is_scalar_boundary(c))
      return scan_value_start(lexer, valid);
  }
  if (valid[INVALID_SPECIAL_FLOAT] && (c == 'i' || c == 'n'))
    return scan_value_start(lexer, valid);
  if (scan_time_suffix(scanner, lexer, valid, c)) return true;
  if ((c == 'e' || c == 'E') && valid[EXPONENT_START]) {
    if (adjacent_keyval(scanner, lexer, valid, false))
      return end_before_keyval(lexer, valid);
    return emit_element_start(scanner, lexer, valid, EXPONENT_START);
  }
  if (
    c == '.' && emit_element_start(scanner, lexer, valid, FLOAT_FRACTION_START)
  )
    return true;
  if (c == '0' && valid[LEADING_ZERO]) return scan_leading_zero(lexer, valid);
  if (c == '_' && valid[LEADING_SEPARATOR])
    return take_leading_separator(scanner, lexer, valid, base);
  if (
    valid_base_token(valid, INVALID_DEC_DIGIT, base) &&
    !lexer->eof(lexer) &&
    !is_scalar_boundary(c) &&
    !is_base_digit(c, base) &&
    !(c == '_' && valid[INCOMPLETE_NUMBER])
  )
    return take_invalid_digits(scanner, lexer, valid, base);
  if (c == '_' && valid[INCOMPLETE_NUMBER])
    return take_separator_run(scanner, lexer, valid, base);
  if (
    !lexer->eof(lexer) && valid[INVALID_KEY_CHARACTER] && is_invalid_key_char(c)
  )
    return take_invalid_characters(lexer, valid, INVALID_KEY_CHARACTER);
  if (c == '\r' && valid[INVALID_LINE_ENDING])
    return scan_carriage_return(lexer, valid);

  bool spaced = false;
  while (is_space(lexer->lookahead)) {
    lexer->advance(lexer, true);
    spaced = true;
  }
  lexer->mark_end(lexer);
  c = lexer->lookahead;
  continue_rejected_key(scanner, c, spaced);
  const bool end = lexer->eof(lexer) || is_newline(c);

  if (scan_missing_close(scanner, lexer, valid, c, end)) return true;
  if (c == ']' && valid[INVALID_ARRAY_TABLE_CLOSE])
    return scan_array_table_close(lexer, valid);
  if (c == ']' && valid[ARRAY_CLOSE])
    return take_close(&scanner->arrays, lexer, valid, ARRAY_CLOSE);
  if (c == '}' && valid[INLINE_TABLE_CLOSE])
    return take_close(
      &scanner->inline_tables,
      lexer,
      valid,
      INLINE_TABLE_CLOSE
    );
  if (
    c == '}' &&
    scanner->inline_tables &&
    emit_missing_close(
      &scanner->arrays,
      lexer,
      valid,
      INVALID_MISSING_ARRAY_CLOSE
    )
  )
    return true;
  if (
    c == ']' &&
    scanner->arrays &&
    emit_missing_close(
      &scanner->inline_tables,
      lexer,
      valid,
      INVALID_MISSING_INLINE_TABLE_CLOSE
    )
  )
    return true;
  if (
    (valid[STRAY_CLOSE] || valid[UNEXPECTED_CHARACTER_CONTINUATION]) &&
    ((c == ']' && !scanner->arrays) || (c == '}' && !scanner->inline_tables))
  )
    return !spaced && take_stray_close(lexer, valid, c);
  // Leave leading layout to the list before starting its item.
  if ((c == '[' || c == '{') && valid[UNEXPECTED_VALUE])
    return !spaced && emit(lexer, valid, UNEXPECTED_VALUE);
  if (c == '[' && valid[ARRAY_OPEN])
    return !spaced && take_open(&scanner->arrays, lexer, valid, ARRAY_OPEN);
  if (c == '{' && valid[INLINE_TABLE_OPEN])
    return !spaced &&
      take_open(&scanner->inline_tables, lexer, valid, INLINE_TABLE_OPEN);

  if (
    (end || c == '#' || c == ']' || c == '}' || c == ',') &&
    (emit_missing(lexer, valid, INVALID_MISSING_VALUE) ||
      emit_missing(lexer, valid, INVALID_MISSING_ASSIGNMENT_OPERATOR) ||
      emit_missing(lexer, valid, INVALID_MISSING_KEY))
  )
    return true;
  if (c == '=' && valid[MISSING_PAIR_KEY])
    return !spaced && emit(lexer, valid, MISSING_PAIR_KEY);
  if (c == '.' && valid[DOT_SEPARATOR])
    return take(lexer, valid, DOT_SEPARATOR);
  if (c == '.' && valid[MISSING_DOTTED_KEY])
    return !spaced && emit(lexer, valid, MISSING_DOTTED_KEY);
  if (
    (c == '=' || c == '.' || c == '[' || c == '{' || c == ',') &&
    emit_missing(lexer, valid, INVALID_MISSING_KEY)
  )
    return true;
  if (
    !end &&
    c != '.' &&
    c != '=' &&
    (spaced || !is_key_char(c) || !valid[INVALID_KEY_CHARACTER]) &&
    emit_missing(lexer, valid, INVALID_MISSING_ASSIGNMENT_OPERATOR)
  )
    return true;

  const bool number_continuation = !spaced &&
    !is_scalar_boundary(c) &&
    (valid_base_token(valid, INVALID_DEC_DIGIT, base) ||
      valid_base_token(valid, DEC_CONTINUATION, base));
  if (
    !end &&
    c != ',' &&
    c != ']' &&
    c != '}' &&
    c != '#' &&
    !number_continuation &&
    scan_missing_separator(lexer, valid, c, spaced)
  )
    return true;
  if (
    !end &&
    (valid[UNEXPECTED_CHARACTER_START] ||
      (!spaced && valid[UNEXPECTED_CHARACTER_CONTINUATION])) &&
    starts_junk(scanner, valid, c, number_continuation)
  )
    return scan_junk_start(scanner, lexer, valid, c, spaced);
  if (!end && valid[UNEXPECTED_CHARACTER])
    return take_unexpected_character(scanner, lexer, valid, c);
  if (
    valid[EXPRESSION_END] &&
    (end || (c != '#' && (spaced || is_scalar_boundary(c))))
  )
    return emit(lexer, valid, EXPRESSION_END);
  return !end && emit(lexer, valid, MISSING_NEWLINE);
}
