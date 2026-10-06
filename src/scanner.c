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
  INVALID_HEADER_ENCODING,
  ESCAPE_PREFIX,
  ERROR_SENTINEL,
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
  // A key lookahead must not turn an existing invalid word into an exponent.
  bool word_continuation;
};

static bool space(int32_t c) {
  return c == ' ' || c == '\t';
}

static bool line(int32_t c) {
  return c == '\r' || c == '\n';
}

static bool control(int32_t c) {
  return (c >= 0 && c < 0x20 && !space(c) && !line(c)) || c == 0x7f;
}

static bool scalar_boundary(int32_t c) {
  return space(c) ||
    line(c) ||
    c ==
    '#' ||
    c ==
    ',' ||
    c ==
    '[' ||
    c ==
    ']' ||
    c ==
    '{' ||
    c ==
    '}' ||
    c ==
    '"' ||
    c == '\'';
}

static bool hex(int32_t c) {
  return (c >= '0' && c <= '9') ||
    (c >= 'A' && c <= 'F') ||
    (c >= 'a' && c <= 'f');
}

static bool key_character(int32_t c) {
  return (c >= 'A' && c <= 'Z') ||
    (c >= 'a' && c <= 'z') ||
    (c >= '0' && c <= '9') ||
    c ==
    '_' ||
    c == '-';
}

static bool number_digit(int32_t c, unsigned base) {
  const int32_t maximum[] = {'9', '9', '7', '1'};
  return base == 1 ? hex(c) : c >= '0' && c <= maximum[base];
}

static unsigned number_base(const bool *valid) {
  return valid[INVALID_HEX_DIGIT] ? 1
    : valid[INVALID_OCT_DIGIT]    ? 2
    : valid[INVALID_BIN_DIGIT]    ? 3
                                  : 0;
}

static bool invalid_key_character(int32_t c) {
  return c !=
    -1 &&
    !key_character(c) &&
    !scalar_boundary(c) &&
    c !=
    '.' &&
    c != '=';
}

static bool invalid_number_character(int32_t c, unsigned base, bool word) {
  return c !=
    -1 &&
    !scalar_boundary(c) &&
    !number_digit(c, base) &&
    c !=
    '_' &&
    (base != 0 || (c != '.' && (word || (c != 'e' && c != 'E'))));
}

static bool keyval_ahead(TSLexer *lexer, bool bare) {
  for (;; bare = false) {
    const int32_t quote = lexer->lookahead;
    if (!bare && (quote == '"' || quote == '\'')) {
      lexer->advance(lexer, false);
      while (
        !lexer->eof(lexer) &&
        !line(lexer->lookahead) &&
        lexer->lookahead != quote
      ) {
        if (quote == '"' && lexer->lookahead == '\\') {
          lexer->advance(lexer, false);
          if (lexer->eof(lexer) || line(lexer->lookahead))
            return false;
        }
        lexer->advance(lexer, false);
      }
      if (lexer->eof(lexer) || lexer->lookahead != quote)
        return false;
      lexer->advance(lexer, false);
    } else {
      if (!bare && !key_character(lexer->lookahead))
        return false;
      while (key_character(lexer->lookahead))
        lexer->advance(lexer, false);
    }
    while (space(lexer->lookahead))
      lexer->advance(lexer, false);
    if (lexer->lookahead == '=')
      return true;
    if (lexer->lookahead != '.')
      return false;
    lexer->advance(lexer, false);
    while (space(lexer->lookahead))
      lexer->advance(lexer, false);
  }
}
// Consume rejected key chains once to avoid repeated suffix lookahead.
static enum RejectedKey junk_keys(TSLexer *lexer) {
  enum RejectedKey next = REJECTED_KEY;
  for (bool first = true;; first = false) {
    const int32_t quote = lexer->lookahead;
    if (quote == '"' || quote == '\'') {
      lexer->advance(lexer, false);
      if (first)
        lexer->mark_end(lexer);
      while (lexer->lookahead != quote) {
        if (quote == '"' && lexer->lookahead == '\\')
          lexer->advance(lexer, false);
        if (
          lexer->eof(lexer) || line(lexer->lookahead) || lexer->lookahead == -1
        )
          return NO_REJECTED_KEY;
        lexer->advance(lexer, false);
      }
      lexer->advance(lexer, false);
    } else if (key_character(quote)) {
      while (key_character(lexer->lookahead))
        lexer->advance(lexer, false);
    } else {
      return next;
    }
    next = REJECTED_DOT;
    lexer->mark_end(lexer);
    if (lexer->lookahead != '.')
      return next;
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    next = REJECTED_KEY;
  }
}

static bool emit(TSLexer *lexer, const bool *valid, enum TokenType token) {
  if (!valid[token])
    return false;
  lexer->result_symbol = token;
  // Edits inside the final lookahead character must invalidate this token.
  if (!lexer->eof(lexer))
    lexer->advance(lexer, false);
  return true;
}

static bool adjacent_keyval(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  bool bare
) {
  if (!valid[EXPRESSION_END] && !valid[MISSING_INLINE_TABLE_SEPARATOR])
    return false;
  if (scanner->rejected_key != NO_REJECTED_KEY)
    return false;
  if (keyval_ahead(lexer, bare))
    return true;
  scanner->rejected_key = REJECTED_KEY;
  return false;
}

static void
check_rejected_key(struct Scanner *scanner, int32_t c, bool spaced) {
  if (
    (scanner->rejected_key == REJECTED_KEY && !key_character(c)) ||
    (scanner->rejected_key == REJECTED_DOT && c != '.') ||
    (scanner->rejected_key ==
      REJECTED_KEY_CONTINUATION &&
      c !=
      '.' &&
      (spaced || !key_character(c)))
  )
    scanner->rejected_key = NO_REJECTED_KEY;
}

static bool missing(TSLexer *lexer, const bool *valid, enum TokenType token) {
  return emit(
    lexer,
    valid,
    (enum TokenType)(token + (lexer->eof(lexer) ? 1 : 0))
  );
}

static bool take(TSLexer *lexer, const bool *valid, enum TokenType token) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  return emit(lexer, valid, token);
}

static void
number_junk(struct Scanner *scanner, TSLexer *lexer, unsigned base, bool word) {
  bool previous_key = word;
  scanner->word_continuation = false;
  while (!lexer->eof(lexer)) {
    const int32_t c = lexer->lookahead;
    if (
      key_character(c) &&
      !number_digit(c, base) &&
      c !=
      '_' &&
      (!word || (!previous_key && scanner->rejected_key == NO_REJECTED_KEY))
    ) {
      scanner->word_continuation = word;
      return;
    }
    previous_key = key_character(c);
    if (c == '_') {
      if (scanner->rejected_key != NO_REJECTED_KEY)
        scanner->rejected_key = REJECTED_KEY_CONTINUATION;
      lexer->advance(lexer, false);
      if (number_digit(lexer->lookahead, base))
        return;
    } else if (invalid_number_character(c, base, word)) {
      word = word || key_character(c);
      if (scanner->rejected_key != NO_REJECTED_KEY)
        scanner->rejected_key =
          key_character(c) ? REJECTED_KEY_CONTINUATION : NO_REJECTED_KEY;
      lexer->advance(lexer, false);
    } else {
      return;
    }
    lexer->mark_end(lexer);
  }
}

static bool take_invalid(
  struct Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  enum TokenType token
) {
  const bool word = key_character(lexer->lookahead);
  if (token >= INVALID_DEC_DIGIT && token <= INVALID_BIN_DIGIT) {
    if (scanner->rejected_key != NO_REJECTED_KEY)
      scanner->rejected_key = word ? REJECTED_KEY_CONTINUATION
        : lexer->lookahead == '.'  ? REJECTED_KEY
                                   : NO_REJECTED_KEY;
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    number_junk(scanner, lexer, token - INVALID_DEC_DIGIT, word);
    return emit(lexer, valid, token);
  }
  do {
    lexer->advance(lexer, false);
  } while (
    !lexer->eof(lexer) &&
    (token == INVALID_KEY_CHARACTER ? invalid_key_character(lexer->lookahead)
                                    : control(lexer->lookahead))
  );
  lexer->mark_end(lexer);
  return emit(lexer, valid, token);
}

static bool continue_invalid(TSLexer *lexer, const bool *valid, int32_t c) {
  return (c == '.' || c == 'e' || c == 'E') &&
    emit(lexer, valid, INVALID_DEC_CONTINUATION);
}

static bool escape(TSLexer *lexer, const bool *valid) {
  lexer->advance(lexer, false);
  int32_t c = lexer->lookahead;
  if (c == -1)
    return emit(lexer, valid, ESCAPE_PREFIX);
  if (
    c ==
    '"' ||
    c ==
    '\\' ||
    c ==
    'b' ||
    c ==
    'e' ||
    c ==
    'f' ||
    c ==
    'n' ||
    c ==
    'r' ||
    c == 't'
  )
    return false;
  bool appendable = lexer->eof(lexer);
  unsigned remaining = c == 'x' ? 2 : c == 'u' ? 4 : c == 'U' ? 8 : 0;
  if (remaining) {
    uint32_t value = 0;
    lexer->advance(lexer, false);
    while (remaining && hex(lexer->lookahead)) {
      const int32_t digit = lexer->lookahead;
      value = value *
        16 +
        (uint32_t)(digit <= '9' ? digit - '0' : (digit | 32) - 'a' + 10);
      lexer->advance(lexer, false);
      remaining--;
    }
    if (!remaining) {
      return (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) &&
        emit(lexer, valid, INVALID_UNICODE_ESCAPE);
    }
    const uint64_t lower = (uint64_t)value << (remaining * 4);
    const uint64_t upper = lower | ((UINT64_C(1) << (remaining * 4)) - 1);
    const bool scalar =
      lower <= 0x10ffff && !(lower >= 0xd800 && upper <= 0xdfff);
    if (scalar && lexer->lookahead == -1)
      return emit(lexer, valid, ESCAPE_PREFIX);
    lexer->mark_end(lexer);
    appendable = lexer->eof(lexer) && scalar;
  } else if (space(c) || line(c)) {
    lexer->mark_end(lexer);
    if (valid[MISSING_ML_BASIC_STRING_CLOSE]) {
      while (space(lexer->lookahead))
        lexer->advance(lexer, false);
      if (lexer->lookahead == '\n')
        return false;
      if (lexer->lookahead == '\r') {
        lexer->advance(lexer, false);
        if (lexer->lookahead == '\n')
          return false;
      }
      if (lexer->eof(lexer)) {
        lexer->mark_end(lexer);
        appendable = true;
      }
    }
  } else if (!lexer->eof(lexer)) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
  } else
    lexer->mark_end(lexer);
  return emit(lexer, valid, appendable ? INCOMPLETE_ESCAPE : INVALID_ESCAPE);
}

static bool date_element(TSLexer *lexer, const bool *valid) {
  const enum TokenType starts[] = {
    DATE_FULLYEAR_START,
    DATE_MONTH_START,
    DATE_MDAY_START,
    TIME_HOUR_START,
    TIME_MINUTE_START,
    TIME_SECOND_START
  };
  const enum TokenType errors[] = {
    INVALID_DATE_MONTH,
    INVALID_DATE_MDAY,
    INVALID_TIME_HOUR,
    INVALID_TIME_MINUTE,
    INVALID_TIME_SECOND
  };
  const unsigned maximum[] = {12, 31, 23, 59, 60};
  const unsigned minimum[] = {1, 1, 0, 0, 0};
  unsigned index = 0;
  while (index < 6 && !valid[starts[index]])
    index++;
  if (index == 6 || lexer->lookahead < '0' || lexer->lookahead > '9')
    return false;
  unsigned count = 0, value = 0;
  while (lexer->lookahead >= '0' && lexer->lookahead <= '9') {
    if (count < 5) {
      value = value * 10 + (unsigned)(lexer->lookahead - '0');
      count++;
    }
    lexer->advance(lexer, false);
  }
  if (
    valid[DATE_FULLYEAR_START] &&
    valid[TIME_HOUR_START] &&
    lexer->lookahead == ':'
  )
    index = 3;
  if (index == 0)
    return count == 4 && emit(lexer, valid, DATE_FULLYEAR_START);
  const unsigned element = index - 1;
  if (count == 2 && value >= minimum[element] && value <= maximum[element])
    return emit(lexer, valid, starts[index]);
  unsigned lower = value, upper = value;
  for (unsigned i = count; i < 2; i++) {
    lower *= 10;
    upper = upper * 10 + 9;
  }
  const bool incomplete = count <
    2 &&
    lexer->eof(lexer) &&
    lower <=
    maximum[element] &&
    upper >= minimum[element];
  return emit(
    lexer,
    valid,
    (enum TokenType)(errors[element] + (incomplete ? 1 : 0))
  );
}

static bool scalar_start(TSLexer *lexer, const bool *valid) {
  const int32_t first = lexer->lookahead;
  if (
    (first >= '0' && first <= '9') ||
    first ==
    '+' ||
    first ==
    '-' ||
    first == '.'
  ) {
    bool base = false, floating = first == '.', date = false,
         initial_digits = true;
    unsigned length = 0;
    bool word = false;
    while (
      !lexer->eof(lexer) &&
      lexer->lookahead !=
      -1 &&
      !scalar_boundary(lexer->lookahead)
    ) {
      const int32_t c = lexer->lookahead;
      if (length == 1 && first == '0' && (c == 'x' || c == 'o' || c == 'b'))
        base = true;
      if (
        !base &&
        length >
        0 &&
        ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) &&
        !((first == '+' || first == '-') &&
          length ==
          1 &&
          (c == 'i' || c == 'n')) &&
        !(date && (c == 'T' || c == 't' || c == 'Z' || c == 'z'))
      ) {
        const bool assignment = keyval_ahead(lexer, false);
        if (!assignment && (c == 'e' || c == 'E') && !word)
          floating = true;
        return emit(
          lexer,
          valid,
          date         ? DATE_START
            : floating ? FLOAT_START
                       : INTEGER_START
        );
      }
      if (
        !base &&
        (c ==
          '.' ||
          ((first == '+' || first == '-') &&
            length ==
            1 &&
            (c == 'i' || c == 'n')))
      )
        floating = true;
      if (
        initial_digits && length > 0 && (c == ':' || (length == 4 && c == '-'))
      )
        date = true;
      if (c < '0' || c > '9')
        initial_digits = false;
      if ((c >= '0' && c <= '9') || c == '.')
        word = false;
      else if (length > 0 && c != '_')
        word = word || key_character(c);
      lexer->advance(lexer, false);
      if (length < 5)
        length++;
    }
    if (
      first ==
      '0' &&
      initial_digits &&
      length >=
      2 &&
      length <=
      4 &&
      lexer->eof(lexer)
    )
      return emit(lexer, valid, INCOMPLETE_NUMERIC_VALUE);
    return emit(
      lexer,
      valid,
      date         ? DATE_START
        : floating ? FLOAT_START
                   : INTEGER_START
    );
  }
  const char *const word = first == 't' ? "true"
    : first == 'f'                      ? "false"
    : first == 'i'                      ? "inf"
    : first == 'n'                      ? "nan"
                                        : "";
  unsigned position = 0;
  bool prefix = word[0] != '\0';
  while (
    !lexer->eof(lexer) &&
    lexer->lookahead !=
    -1 &&
    !scalar_boundary(lexer->lookahead)
  ) {
    if (!word[position] || lexer->lookahead != word[position])
      prefix = false;
    if (word[position])
      position++;
    lexer->advance(lexer, false);
    if (prefix && !word[position])
      return first == 'i' || first == 'n' ? emit(lexer, valid, FLOAT_START)
                                          : false;
  }
  lexer->mark_end(lexer);
  const bool incomplete = prefix && lexer->eof(lexer);
  return emit(
    lexer,
    valid,
    valid[INVALID_SPECIAL_FLOAT]
      ? (incomplete ? INCOMPLETE_SPECIAL_FLOAT : INVALID_SPECIAL_FLOAT)
      : (incomplete ? INCOMPLETE_VALUE : INVALID_VALUE)
  );
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
  if (scanner->rejected_key == NO_REJECTED_KEY && !scanner->word_continuation)
    return 0;
  buffer[0] =
    (char)(scanner->rejected_key | (scanner->word_continuation ? 4 : 0));
  return 1;
}

void tree_sitter_toml_external_scanner_deserialize(
  void *payload,
  const char *buffer,
  unsigned length
) {
  struct Scanner *scanner = payload;
  scanner->rejected_key =
    length == 1 ? (enum RejectedKey)(buffer[0] & 3) : NO_REJECTED_KEY;
  scanner->word_continuation = length == 1 && (buffer[0] & 4) != 0;
}

bool tree_sitter_toml_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid
) {
  struct Scanner *scanner = payload;
  bool numeric = false;
  for (unsigned base = 0; base < 4; base++)
    numeric = numeric ||
      valid[DEC_CONTINUATION + base] ||
      valid[DEC_JUNK_CONTINUATION + base] ||
      valid[INVALID_DEC_CONTINUATION + base] ||
      valid[INVALID_DEC_DIGIT + base];
  if (
    (!valid[UNEXPECTED_CHARACTER_START] &&
      !valid[UNEXPECTED_CHARACTER_CONTINUATION] &&
      !valid[UNEXPECTED_CHARACTER] &&
      !numeric) ||
    valid[INTEGER_START] ||
    valid[FLOAT_START] ||
    valid[DATE_START] ||
    line(lexer->lookahead) ||
    lexer->eof(lexer) ||
    lexer->is_at_included_range_start(lexer)
  )
    scanner->rejected_key = NO_REJECTED_KEY;
  if (!space(lexer->lookahead))
    check_rejected_key(scanner, lexer->lookahead, false);
  if (valid[ERROR_SENTINEL])
    return false;
  int32_t c = lexer->lookahead;
  lexer->mark_end(lexer);
  const bool string_body = valid[INVALID_ESCAPE] ||
    valid[MISSING_ML_LITERAL_STRING_CLOSE] ||
    valid[INVALID_MISSING_LITERAL_STRING_CLOSE];
  if (valid[NUMERIC_PREFIX_DIGITS_START]) {
    if (number_digit(c, number_base(valid)))
      return emit(lexer, valid, NUMERIC_PREFIX_DIGITS_START);
  }
  if (
    ((valid[FRACTION_DIGITS_START] && c != 'e' && c != 'E') ||
      valid[SIGNED_EXPONENT_DIGITS_START] ||
      (valid[EXPONENT_DIGITS_START] && c != '+' && c != '-')) &&
    !lexer->eof(lexer) &&
    !scalar_boundary(c)
  )
    return emit(
      lexer,
      valid,
      valid[FRACTION_DIGITS_START]            ? FRACTION_DIGITS_START
        : valid[SIGNED_EXPONENT_DIGITS_START] ? SIGNED_EXPONENT_DIGITS_START
                                              : EXPONENT_DIGITS_START
    );
  if (valid[DATE_ELEMENT_END])
    return (c < '0' || c > '9') && emit(lexer, valid, DATE_ELEMENT_END);
  if (
    c ==
    -1 &&
    !valid[DEC_CONTINUATION] &&
    !valid[HEX_CONTINUATION] &&
    !valid[OCT_CONTINUATION] &&
    !valid[BIN_CONTINUATION]
  ) {
    enum TokenType token = valid[UNEXPECTED_ENCODING] ? UNEXPECTED_ENCODING
      : valid[INVALID_HEADER_ENCODING] && !valid[INVALID_KEY_CHARACTER]
      ? INVALID_HEADER_ENCODING
      : INVALID_ENCODING;
    for (
      enum TokenType number = INVALID_DEC_ENCODING;
      number <= INVALID_BIN_ENCODING;
      number++
    )
      if (valid[number]) {
        token = number;
        break;
      }
    if (valid[token]) {
      do {
        lexer->advance(lexer, false);
      } while (!lexer->eof(lexer) && lexer->lookahead == -1);
      lexer->mark_end(lexer);
      return emit(lexer, valid, token);
    }
  }
  if (c == '#' && valid[BROKEN_COMMENT_START]) {
    bool invalid = false;
    while (!lexer->eof(lexer) && !line(lexer->lookahead)) {
      const int32_t next = lexer->lookahead;
      if ((next < 0x20 && next != '\t') || next == 0x7f)
        invalid = true;
      lexer->advance(lexer, false);
    }
    return invalid && emit(lexer, valid, BROKEN_COMMENT_START);
  }
  if (valid[COMMENT_END]) {
    if (lexer->eof(lexer) || line(c))
      return emit(lexer, valid, COMMENT_END);
    if (c == '\t' || (c >= 0x20 && c != 0x7f))
      return false;
  }
  if (valid[BLANK_LINE] && space(c)) {
    while (space(lexer->lookahead))
      lexer->advance(lexer, false);
    if (!line(lexer->lookahead) && !lexer->eof(lexer))
      return false;
    lexer->mark_end(lexer);
    return emit(lexer, valid, BLANK_LINE);
  }
  if (
    c !=
    '-' &&
    (valid[INVALID_MISSING_DATE_SEPARATOR] ||
      valid[INCOMPLETE_MISSING_DATE_SEPARATOR])
  )
    return missing(lexer, valid, INVALID_MISSING_DATE_SEPARATOR);
  if (
    c !=
    ':' &&
    (valid[INVALID_MISSING_TIME_SEPARATOR] ||
      valid[INCOMPLETE_MISSING_TIME_SEPARATOR])
  )
    return missing(lexer, valid, INVALID_MISSING_TIME_SEPARATOR);
  if (
    (c < '0' || c > '9') &&
    (valid[DATE_MONTH_START] ||
      valid[DATE_MDAY_START] ||
      valid[TIME_HOUR_START] ||
      valid[TIME_MINUTE_START] ||
      valid[TIME_SECOND_START] ||
      valid[TIME_FRACTION_DIGITS_START]) &&
    (valid[INVALID_MISSING_DIGITS] || valid[INCOMPLETE_MISSING_DIGITS])
  )
    return missing(lexer, valid, INVALID_MISSING_DIGITS);
  if (c >= '0' && c <= '9' && emit(lexer, valid, TIME_FRACTION_DIGITS_START))
    return true;
  if (
    c >=
    '0' &&
    c <=
    '9' &&
    (valid[DATE_FULLYEAR_START] ||
      valid[DATE_MONTH_START] ||
      valid[DATE_MDAY_START] ||
      valid[TIME_HOUR_START] ||
      valid[TIME_MINUTE_START] ||
      valid[TIME_SECOND_START])
  )
    return date_element(lexer, valid);
  if (valid[DATE_END]) {
    if (c == 'T' || c == 't')
      return adjacent_keyval(scanner, lexer, valid, false) &&
        emit(lexer, valid, DATE_END);
    if (c == ' ') {
      lexer->advance(lexer, false);
      unsigned count = 0;
      while (count < 2 && lexer->lookahead >= '0' && lexer->lookahead <= '9') {
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
  if (
    (lexer->eof(lexer) ||
      scalar_boundary(c) ||
      ((c == '.' || c == 'e' || c == 'E') &&
        !valid[INVALID_HEX_DIGIT] &&
        !valid[INVALID_OCT_DIGIT] &&
        !valid[INVALID_BIN_DIGIT])) &&
    missing(lexer, valid, INVALID_MISSING_DIGITS)
  )
    return true;
  if (c == '=' && !string_body && valid[INVALID_CHARACTER]) {
    return take(lexer, valid, INVALID_CHARACTER);
  }
  for (unsigned base = 0; base < 4; base++) {
    const enum TokenType continuation =
      (enum TokenType)(INVALID_DEC_CONTINUATION + base);
    if (
      !valid[continuation] ||
      lexer->eof(lexer) ||
      c ==
      -1 ||
      scalar_boundary(c) ||
      number_digit(c, base) ||
      (c == '_' && valid[DEC_CONTINUATION + base])
    )
      continue;
    if (
      valid[NUMBER_END] &&
      key_character(c) &&
      adjacent_keyval(scanner, lexer, valid, false)
    ) {
      scanner->word_continuation = false;
      return emit(lexer, valid, NUMBER_END);
    }
    if (
      base ==
      0 &&
      ((c == '.' && valid[FLOAT_FRACTION_START]) ||
        ((c == 'e' || c == 'E') &&
          valid[EXPONENT_START] &&
          !scanner->word_continuation))
    )
      continue;
    return emit(lexer, valid, continuation);
  }
  scanner->word_continuation = false;
  for (unsigned base = 0; base < 4; base++) {
    const enum TokenType token = (enum TokenType)(DEC_JUNK_CONTINUATION + base);
    if (!valid[token])
      continue;
    if (
      base ==
      0 &&
      (((c == 'e' || c == 'E') && valid[EXPONENT_START]) ||
        (c == '.' && valid[FLOAT_FRACTION_START]))
    )
      return emit(lexer, valid, NUMBER_JUNK_END);
    if (base == 0 && continue_invalid(lexer, valid, c))
      return true;
    if (lexer->eof(lexer) || (!key_character(c) && c != '.'))
      return emit(lexer, valid, NUMBER_JUNK_END);
    if (
      valid[NUMBER_END] &&
      key_character(c) &&
      !number_digit(c, base) &&
      c !=
      '_' &&
      adjacent_keyval(scanner, lexer, valid, false)
    )
      return emit(lexer, valid, NUMBER_END);
    return emit(lexer, valid, token);
  }
  if (!lexer->eof(lexer) && !scalar_boundary(c)) {
    for (unsigned base = 0; base < 4; base++) {
      const enum TokenType continuation =
        (enum TokenType)(DEC_CONTINUATION + base);
      if (!valid[continuation])
        continue;
      if (c == '_') {
        lexer->advance(lexer, false);
        if (number_digit(lexer->lookahead, base))
          return emit(lexer, valid, continuation);
      }
      // The end marker keeps this lookahead inside the number for reparsing.
      if (
        !number_digit(c, base) &&
        key_character(c) &&
        (valid[EXPRESSION_END] || valid[MISSING_INLINE_TABLE_SEPARATOR])
      ) {
        if (adjacent_keyval(scanner, lexer, valid, c == '_'))
          return emit(lexer, valid, NUMBER_END);
        if (
          !(base == 0 && (c == 'e' || c == 'E')) &&
          emit(lexer, valid, (enum TokenType)(DEC_JUNK_START + base))
        )
          return true;
      }
      if (
        base ==
        0 &&
        (c == 'e' || c == 'E') &&
        emit(lexer, valid, EXPONENT_START)
      )
        return true;
      if (base == 0 && c == '.' && emit(lexer, valid, FLOAT_FRACTION_START))
        return true;
      if (base == 0 && continue_invalid(lexer, valid, c))
        return true;
      return emit(lexer, valid, continuation);
    }
  }
  if (!lexer->eof(lexer) && control(c)) {
    enum TokenType token = valid[INVALID_KEY_CHARACTER] ? INVALID_KEY_CHARACTER
      : valid[INVALID_CHARACTER]                        ? INVALID_CHARACTER
                                                        : UNEXPECTED_CHARACTER;
    for (
      enum TokenType digit = INVALID_DEC_DIGIT; digit <= INVALID_BIN_DIGIT;
      digit++
    )
      if (valid[digit]) {
        token = digit;
        break;
      }
    if (valid[token])
      return take_invalid(scanner, lexer, valid, token);
  }
  if (valid[INTEGER_START] || valid[FLOAT_START] || valid[DATE_START]) {
    if (c == '"' || c == '\'' || c == '[' || c == '{')
      return false;
    if (!lexer->eof(lexer) && c != '=' && !scalar_boundary(c))
      return scalar_start(lexer, valid);
  }
  if (valid[INVALID_SPECIAL_FLOAT] && (c == 'i' || c == 'n'))
    return scalar_start(lexer, valid);

  if (
    valid[TIME_END] &&
    (c == 'Z' || c == 'z' || c == '-') &&
    adjacent_keyval(scanner, lexer, valid, false)
  )
    return emit(lexer, valid, TIME_END);
  if (
    (c == 'Z' || c == 'z' || c == '+' || c == '-') &&
    emit(lexer, valid, UNEXPECTED_TIME_OFFSET)
  )
    return true;
  if (c == '.' && emit(lexer, valid, UNEXPECTED_TIME_FRACTION))
    return true;
  if ((c == 'e' || c == 'E') && valid[EXPONENT_START]) {
    if (adjacent_keyval(scanner, lexer, valid, false))
      return emit(lexer, valid, EXPRESSION_END) ||
        emit(lexer, valid, MISSING_INLINE_TABLE_SEPARATOR);
    return emit(lexer, valid, EXPONENT_START);
  }
  if (c == '.' && emit(lexer, valid, FLOAT_FRACTION_START))
    return true;
  if (c == ':' && emit(lexer, valid, TIME_SECONDS_START))
    return true;
  if (c == '.' && emit(lexer, valid, TIME_FRACTION_START))
    return true;
  if (
    (c == 'Z' || c == 'z' || c == '+' || c == '-') &&
    emit(lexer, valid, TIME_OFFSET_START)
  )
    return true;
  if (c == '0' && valid[LEADING_ZERO]) {
    lexer->advance(lexer, false);
    if (
      (lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
      lexer->lookahead == '_'
    )
      return emit(lexer, valid, LEADING_ZERO);
    return false;
  }
  // Without a preceding digit, '_' continues the invalid run.
  if (c == '_' && emit(lexer, valid, INVALID_DEC_CONTINUATION))
    return true;
  if (c == '_' && valid[LEADING_SEPARATOR]) {
    do {
      lexer->advance(lexer, false);
    } while (lexer->lookahead == '_');
    lexer->mark_end(lexer);
    number_junk(scanner, lexer, number_base(valid), false);
    return emit(lexer, valid, LEADING_SEPARATOR);
  }
  if (continue_invalid(lexer, valid, c))
    return true;
  if (!lexer->eof(lexer) && !scalar_boundary(c)) {
    for (unsigned base = 0; base < 4; base++) {
      const enum TokenType invalid = (enum TokenType)(INVALID_DEC_DIGIT + base);
      if (
        !valid[invalid] ||
        number_digit(c, base) ||
        (c == '_' && valid[INCOMPLETE_NUMBER])
      )
        continue;
      return take_invalid(scanner, lexer, valid, invalid);
    }
  }
  if (c == '_' && valid[INCOMPLETE_NUMBER]) {
    const unsigned base = number_base(valid);
    const enum TokenType invalid = (enum TokenType)(INVALID_DEC_DIGIT + base);
    unsigned count = 0;
    do {
      lexer->advance(lexer, false);
      count++;
      if (number_digit(lexer->lookahead, base))
        return count > 1 && emit(lexer, valid, invalid);
      lexer->mark_end(lexer);
    } while (lexer->lookahead == '_');
    const bool incomplete = count == 1 && lexer->eof(lexer);
    number_junk(scanner, lexer, base, false);
    return emit(lexer, valid, incomplete ? INCOMPLETE_NUMBER : invalid);
  }
  if (c == '\\' && (valid[INVALID_ESCAPE] || valid[INCOMPLETE_ESCAPE]))
    return escape(lexer, valid);
  if ((c == '"' && valid[MLB_QUOTE]) || (c == '\'' && valid[MLL_QUOTE])) {
    const enum TokenType symbol = c == '"' ? MLB_QUOTE : MLL_QUOTE;
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    unsigned count = 1;
    while (lexer->lookahead == c && count < 5) {
      lexer->advance(lexer, false);
      count++;
    }
    if (count == 3)
      return false;
    return emit(lexer, valid, symbol);
  }
  const bool key_char = key_character(c);
  const bool key_boundary = scalar_boundary(c) || c == '.' || c == '=';
  if (
    !lexer->eof(lexer) &&
    valid[INVALID_KEY_CHARACTER] &&
    !key_char &&
    !key_boundary
  ) {
    return take_invalid(scanner, lexer, valid, INVALID_KEY_CHARACTER);
  }
  if (c == '\r' && valid[INVALID_LINE_ENDING]) {
    lexer->advance(lexer, false);
    if (lexer->lookahead == '\n')
      return false;
    lexer->mark_end(lexer);
    return emit(
      lexer,
      valid,
      lexer->eof(lexer) ? INCOMPLETE_LINE_ENDING : INVALID_LINE_ENDING
    );
  }
  bool spaced = false;
  if (!string_body) {
    while (space(lexer->lookahead)) {
      lexer->advance(lexer, true);
      spaced = true;
    }
    lexer->mark_end(lexer);
    c = lexer->lookahead;
  }
  check_rejected_key(scanner, c, spaced);
  const bool eof = lexer->eof(lexer), end = eof || line(c);
  if (end) {
    const enum TokenType closings[] = {
      INVALID_MISSING_BASIC_STRING_CLOSE,
      INVALID_MISSING_LITERAL_STRING_CLOSE,
      INVALID_MISSING_STD_TABLE_CLOSE,
      INVALID_MISSING_ARRAY_TABLE_CLOSE
    };
    for (unsigned i = 0; i < sizeof(closings) / sizeof(closings[0]); i++)
      if (missing(lexer, valid, closings[i]))
        return true;
  }
  if (eof) {
    if (
      emit(lexer, valid, MISSING_ML_BASIC_STRING_CLOSE) ||
      emit(lexer, valid, MISSING_ML_LITERAL_STRING_CLOSE) ||
      missing(lexer, valid, INVALID_MISSING_ARRAY_CLOSE) ||
      missing(lexer, valid, INVALID_MISSING_INLINE_TABLE_CLOSE)
    )
      return true;
  }
  if (c == '#' || c == '[' || c == '=') {
    if (missing(lexer, valid, INVALID_MISSING_STD_TABLE_CLOSE))
      return true;
    if (missing(lexer, valid, INVALID_MISSING_ARRAY_TABLE_CLOSE))
      return true;
  }
  if (c == ']' && valid[INVALID_ARRAY_TABLE_CLOSE]) {
    lexer->advance(lexer, false);
    if (lexer->lookahead == ']')
      return false;
    lexer->mark_end(lexer);
    return emit(
      lexer,
      valid,
      lexer->eof(lexer) ? INCOMPLETE_ARRAY_TABLE_CLOSE
                        : INVALID_ARRAY_TABLE_CLOSE
    );
  }
  if (c == '}' && missing(lexer, valid, INVALID_MISSING_ARRAY_CLOSE))
    return true;
  if (c == ']' && missing(lexer, valid, INVALID_MISSING_INLINE_TABLE_CLOSE))
    return true;
  if (end || c == '#' || c == ']' || c == '}' || c == ',') {
    if (missing(lexer, valid, INVALID_MISSING_VALUE))
      return true;
    if (missing(lexer, valid, INVALID_MISSING_ASSIGNMENT_OPERATOR))
      return true;
    if (missing(lexer, valid, INVALID_MISSING_KEY))
      return true;
  }
  if ((c == '[' || c == '{') && emit(lexer, valid, UNEXPECTED_VALUE))
    return true;
  if (c == '=' && emit(lexer, valid, MISSING_PAIR_KEY))
    return true;
  if (c == '.' && valid[DOT_SEPARATOR])
    return take(lexer, valid, DOT_SEPARATOR);
  if (c == '.' && emit(lexer, valid, MISSING_DOTTED_KEY))
    return true;
  if (
    (c == '=' || c == '.' || c == '[' || c == '{' || c == ',') &&
    missing(lexer, valid, INVALID_MISSING_KEY)
  )
    return true;
  if (
    !end &&
    c !=
    '.' &&
    c !=
    '=' &&
    (spaced || !key_char || !valid[INVALID_KEY_CHARACTER]) &&
    missing(lexer, valid, INVALID_MISSING_ASSIGNMENT_OPERATOR)
  )
    return true;
  const bool number_continuation = !spaced &&
    !scalar_boundary(c) &&
    (valid[INVALID_DEC_DIGIT] ||
      valid[INVALID_HEX_DIGIT] ||
      valid[INVALID_OCT_DIGIT] ||
      valid[INVALID_BIN_DIGIT] ||
      valid[DEC_CONTINUATION] ||
      valid[HEX_CONTINUATION] ||
      valid[OCT_CONTINUATION] ||
      valid[BIN_CONTINUATION]);
  if (
    !end && c != ',' && c != ']' && c != '}' && c != '#' && !number_continuation
  ) {
    if (
      emit(lexer, valid, MISSING_ARRAY_SEPARATOR) ||
      ((spaced || !valid[UNEXPECTED_CHARACTER_START] || c == '[' || c == '{') &&
        emit(lexer, valid, MISSING_INLINE_TABLE_SEPARATOR))
    )
      return true;
  }
  if (
    !end &&
    (valid[UNEXPECTED_CHARACTER_START] ||
      (!spaced && valid[UNEXPECTED_CHARACTER_CONTINUATION])) &&
    ((!valid[MISSING_INLINE_TABLE_SEPARATOR] &&
       (c == ']' || c == '}' || c == ',')) ||
      c ==
      ';' ||
      c ==
      '.' ||
      c ==
      '{' ||
      c ==
      '\\' ||
      control(c) ||
      c ==
      -1 ||
      ((valid[EXPRESSION_END] || valid[MISSING_INLINE_TABLE_SEPARATOR]) &&
        !spaced &&
        !number_continuation &&
        (c == '"' || c == '\'' || !scalar_boundary(c))))
  ) {
    if (
      (key_char || c == '"' || c == '\'') &&
      scanner->rejected_key == NO_REJECTED_KEY
    ) {
      if (keyval_ahead(lexer, false))
        return emit(lexer, valid, EXPRESSION_END) ||
          emit(lexer, valid, MISSING_INLINE_TABLE_SEPARATOR);
      if (key_char)
        scanner->rejected_key = REJECTED_KEY;
    }
    return (!spaced &&
             c !=
             -1 &&
             emit(lexer, valid, UNEXPECTED_CHARACTER_CONTINUATION)) ||
      emit(lexer, valid, UNEXPECTED_CHARACTER_START);
  }
  if (!end && valid[UNEXPECTED_CHARACTER]) {
    if (key_char || c == '"' || c == '\'') {
      const enum RejectedKey next = junk_keys(lexer);
      if (scanner->rejected_key != NO_REJECTED_KEY)
        scanner->rejected_key = next;
      return emit(lexer, valid, UNEXPECTED_CHARACTER);
    }
    if (scanner->rejected_key != NO_REJECTED_KEY)
      scanner->rejected_key = c == '.' ? REJECTED_KEY : NO_REJECTED_KEY;
    return take(lexer, valid, UNEXPECTED_CHARACTER);
  }
  if (
    valid[EXPRESSION_END] &&
    (end ||
      (c != '#' && (spaced || scalar_boundary(c) || !number_continuation)))
  )
    return emit(lexer, valid, EXPRESSION_END);
  if (!end && emit(lexer, valid, MISSING_NEWLINE))
    return true;
  return false;
}
