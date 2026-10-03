#include "tree_sitter/parser.h"

enum TokenType {
  MLB_QUOTE,
  MLL_QUOTE,
  INTEGER_START,
  FLOAT_START,
  DATE_START,
  DATE_SPACE,
  TIME_SECONDS_START,
  TIME_FRACTION_START,
  TIME_FRACTION_DIGITS_START,
  TIME_OFFSET_START,
  EXPONENT_START,
  FLOAT_FRACTION_START,
  POSITIVE_EXP_SIGN,
  NEGATIVE_EXP_SIGN,
  EXPONENT_DIGITS_START,
  DEC_CONTINUATION,
  HEX_CONTINUATION,
  OCT_CONTINUATION,
  BIN_CONTINUATION,
  UNEXPECTED_CHARACTER_START,
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
  UNEXPECTED_HEADER_KEY,
  INVALID_HEADER_CHARACTER,
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
  INVALID_NUMBER,
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
  UNEXPECTED_SEPARATOR,
  ERROR_SENTINEL,
  TOKEN_COUNT
};

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
static bool space(int32_t c) {
  return c == ' ' || c == '\t';
}
static bool line(int32_t c) {
  return c == '\r' || c == '\n';
}
static bool control(int32_t c) {
  return (c < 0x20 && !space(c) && !line(c)) || c == 0x7f;
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
static bool keyval_ahead(TSLexer *lexer) {
  for (;;) {
    int32_t quote = lexer->lookahead;
    if (quote == '"' || quote == '\'') {
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
      if (!key_character(lexer->lookahead))
        return false;
      do {
        lexer->advance(lexer, false);
      } while (key_character(lexer->lookahead));
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
static bool emit(TSLexer *lexer, const bool *valid, enum TokenType token) {
  if (!valid[token])
    return false;
  lexer->result_symbol = token;
  return true;
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
static bool escape(TSLexer *lexer, const bool *valid) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  int32_t c = lexer->lookahead;
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
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    while (remaining && hex(lexer->lookahead)) {
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
      remaining--;
    }
    if (!remaining)
      return false;
    appendable = lexer->eof(lexer);
  } else if (space(c) || line(c)) {
    if (valid[MLB_QUOTE]) {
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
  }
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
  // scalar_start admits a date only after exactly four leading digits.
  if (index == 0)
    return count == 4 && emit(lexer, valid, DATE_FULLYEAR_START);
  unsigned element = index - 1;
  if (count == 2 && value >= minimum[element] && value <= maximum[element])
    return emit(lexer, valid, starts[index]);
  unsigned lower = value, upper = value;
  for (unsigned i = count; i < 2; i++) {
    lower *= 10;
    upper = upper * 10 + 9;
  }
  bool incomplete = count <
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
  int32_t first = lexer->lookahead;
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
    while (!lexer->eof(lexer) && !scalar_boundary(lexer->lookahead)) {
      int32_t c = lexer->lookahead;
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
        bool assignment = keyval_ahead(lexer);
        if (!assignment && (c == 'e' || c == 'E'))
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
          c ==
          'e' ||
          c ==
          'E' ||
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
  const char *word = first == 't' ? "true"
    : first == 'f'                ? "false"
    : first == 'i'                ? "inf"
    : first == 'n'                ? "nan"
                                  : "";
  unsigned position = 0;
  bool prefix = word[0] != '\0';
  while (!lexer->eof(lexer) && !scalar_boundary(lexer->lookahead)) {
    if (!word[position] || lexer->lookahead != word[position])
      prefix = false;
    if (word[position])
      position++;
    lexer->advance(lexer, false);
    if (prefix && !word[position])
      return first == 'i' || first == 'n' ? emit(lexer, valid, FLOAT_START)
                                          : false;
  }
  if (prefix && !word[position])
    return first == 'i' || first == 'n' ? emit(lexer, valid, FLOAT_START)
                                        : false;
  lexer->mark_end(lexer);
  bool incomplete = prefix && lexer->eof(lexer);
  return emit(
    lexer,
    valid,
    valid[INVALID_SPECIAL_FLOAT]
      ? (incomplete ? INCOMPLETE_SPECIAL_FLOAT : INVALID_SPECIAL_FLOAT)
      : (incomplete ? INCOMPLETE_VALUE : INVALID_VALUE)
  );
}

bool tree_sitter_toml_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid
) {
  (void)payload;
  if (valid[ERROR_SENTINEL])
    return false;
  int32_t c = lexer->lookahead;
  lexer->mark_end(lexer);
  bool string_body = valid[INVALID_ESCAPE] ||
    valid[MLL_QUOTE] ||
    valid[INVALID_MISSING_LITERAL_STRING_CLOSE];
  if (
    valid[EXPONENT_DIGITS_START] &&
    !lexer->eof(lexer) &&
    !scalar_boundary(c) &&
    !(c == '+' && valid[POSITIVE_EXP_SIGN]) &&
    !(c == '-' && valid[NEGATIVE_EXP_SIGN])
  )
    return emit(lexer, valid, EXPONENT_DIGITS_START);
  if (valid[DATE_ELEMENT_END])
    return (c < '0' || c > '9') && emit(lexer, valid, DATE_ELEMENT_END);
  if (c == '#' && valid[BROKEN_COMMENT_START]) {
    bool invalid = false;
    while (!lexer->eof(lexer) && !line(lexer->lookahead)) {
      int32_t next = lexer->lookahead;
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
  if (c == ' ' && valid[DATE_SPACE]) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
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
    return false;
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
  if (!lexer->eof(lexer) && !scalar_boundary(c)) {
    const enum TokenType continuations[] =
      {DEC_CONTINUATION, HEX_CONTINUATION, OCT_CONTINUATION, BIN_CONTINUATION};
    for (unsigned base = 0; base < 4; base++) {
      if (!valid[continuations[base]])
        continue;
      if (
        (valid[EXPRESSION_END] || valid[MISSING_INLINE_TABLE_SEPARATOR]) &&
        !number_digit(c, base) &&
        key_character(c) &&
        keyval_ahead(lexer)
      )
        return emit(lexer, valid, EXPRESSION_END) ||
          emit(lexer, valid, MISSING_INLINE_TABLE_SEPARATOR);
      if (
        base ==
        0 &&
        (c == 'e' || c == 'E') &&
        emit(lexer, valid, EXPONENT_START)
      )
        return true;
      if (base == 0 && c == '.' && emit(lexer, valid, FLOAT_FRACTION_START))
        return true;
      return emit(lexer, valid, continuations[base]);
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
      return take(lexer, valid, token);
  }
  if (valid[INTEGER_START] || valid[FLOAT_START] || valid[DATE_START]) {
    // Quotes and brackets start a value through the internal lexer.
    if (c == '"' || c == '\'' || c == '[' || c == '{')
      return false;
    if (!lexer->eof(lexer) && c != '=' && !scalar_boundary(c))
      return scalar_start(lexer, valid);
  }
  if (valid[INVALID_SPECIAL_FLOAT] && (c == 'i' || c == 'n'))
    return scalar_start(lexer, valid);

  if (
    (c == 'Z' || c == 'z' || c == '+' || c == '-') &&
    emit(lexer, valid, UNEXPECTED_TIME_OFFSET)
  )
    return true;
  if (c == '.' && emit(lexer, valid, UNEXPECTED_TIME_FRACTION))
    return true;
  if ((c == 'e' || c == 'E') && emit(lexer, valid, EXPONENT_START))
    return true;
  if (c == '.' && emit(lexer, valid, FLOAT_FRACTION_START))
    return true;
  if (
    (c == '+' && valid[POSITIVE_EXP_SIGN]) ||
    (c == '-' && valid[NEGATIVE_EXP_SIGN])
  ) {
    return take(lexer, valid, c == '+' ? POSITIVE_EXP_SIGN : NEGATIVE_EXP_SIGN);
  }
  if (c == ':' && emit(lexer, valid, TIME_SECONDS_START))
    return true;
  if (c == '.' && emit(lexer, valid, TIME_FRACTION_START))
    return true;
  if (
    (c == 'Z' || c == 'z' || c == '+' || c == '-') &&
    emit(lexer, valid, TIME_OFFSET_START)
  )
    return true;
  if ((c == ',' || c == '{' || c == '}') && valid[INVALID_HEADER_CHARACTER]) {
    return take(lexer, valid, INVALID_HEADER_CHARACTER);
  }
  if (c == '0' && valid[LEADING_ZERO]) {
    lexer->advance(lexer, false);
    if (
      (lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
      lexer->lookahead == '_'
    )
      return emit(lexer, valid, LEADING_ZERO);
    return false;
  }
  if (c == '_' && valid[LEADING_SEPARATOR]) {
    return take(lexer, valid, LEADING_SEPARATOR);
  }
  if (!lexer->eof(lexer) && !scalar_boundary(c)) {
    const enum TokenType bad[] = {
      INVALID_DEC_DIGIT,
      INVALID_HEX_DIGIT,
      INVALID_OCT_DIGIT,
      INVALID_BIN_DIGIT
    };
    for (unsigned i = 0; i < 4; i++) {
      if (!valid[bad[i]] || number_digit(c, i) || c == '_')
        continue;
      if (key_character(c)) {
        do {
          lexer->advance(lexer, false);
        } while (
          !lexer->eof(lexer) &&
          key_character(lexer->lookahead) &&
          lexer->lookahead !=
          '_' &&
          !number_digit(lexer->lookahead, i)
        );
        lexer->mark_end(lexer);
        return emit(lexer, valid, bad[i]);
      }
      return take(lexer, valid, bad[i]);
    }
  }
  if (c == '_' && (valid[INVALID_NUMBER] || valid[INCOMPLETE_NUMBER])) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    int32_t next = lexer->lookahead;
    bool good = valid[INVALID_HEX_DIGIT] ? hex(next)
      : valid[INVALID_OCT_DIGIT]         ? next >= '0' && next <= '7'
      : valid[INVALID_BIN_DIGIT]         ? next == '0' || next == '1'
                                         : next >= '0' && next <= '9';
    if (good)
      return false;
    return emit(
      lexer,
      valid,
      lexer->eof(lexer) ? INCOMPLETE_NUMBER : INVALID_NUMBER
    );
  }
  if (c == '\\' && (valid[INVALID_ESCAPE] || valid[INCOMPLETE_ESCAPE]))
    return escape(lexer, valid);
  if ((c == '"' && valid[MLB_QUOTE]) || (c == '\'' && valid[MLL_QUOTE])) {
    enum TokenType symbol = c == '"' ? MLB_QUOTE : MLL_QUOTE;
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
  if (c == ',' && valid[UNEXPECTED_SEPARATOR]) {
    return take(lexer, valid, UNEXPECTED_SEPARATOR);
  }
  bool key_char = key_character(c);
  bool key_boundary = scalar_boundary(c) || c == '.' || c == '=';
  if (
    !lexer->eof(lexer) &&
    valid[INVALID_KEY_CHARACTER] &&
    !key_char &&
    !key_boundary
  ) {
    return take(lexer, valid, INVALID_KEY_CHARACTER);
  }
  if (line(c)) {
    if (missing(lexer, valid, INVALID_MISSING_BASIC_STRING_CLOSE))
      return true;
    if (missing(lexer, valid, INVALID_MISSING_LITERAL_STRING_CLOSE))
      return true;
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
  bool eof = lexer->eof(lexer), end = eof || line(c);
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
  if (end || scalar_boundary(c)) {
    if (missing(lexer, valid, INVALID_MISSING_DIGITS))
      return true;
    if (missing(lexer, valid, INVALID_MISSING_DATE_SEPARATOR))
      return true;
    if (missing(lexer, valid, INVALID_MISSING_TIME_SEPARATOR))
      return true;
  }
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
  if (c == '.' && valid[DOT_SEPARATOR]) {
    return take(lexer, valid, DOT_SEPARATOR);
  }
  if (c == '.' && emit(lexer, valid, MISSING_DOTTED_KEY))
    return true;
  if (
    !end &&
    c !=
    ']' &&
    c !=
    '[' &&
    c !=
    '=' &&
    c !=
    '#' &&
    c !=
    ',' &&
    c !=
    '{' &&
    c !=
    '}' &&
    emit(lexer, valid, UNEXPECTED_HEADER_KEY)
  )
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
  bool time_delimiter = !spaced && valid[DATE_SPACE] && (c == 'T' || c == 't');
  bool number_continuation = !spaced &&
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
    !end &&
    c !=
    ',' &&
    c !=
    ']' &&
    c !=
    '}' &&
    c !=
    '#' &&
    !time_delimiter &&
    !number_continuation
  ) {
    if (
      emit(lexer, valid, MISSING_ARRAY_SEPARATOR) ||
      emit(lexer, valid, MISSING_INLINE_TABLE_SEPARATOR)
    )
      return true;
  }
  if (
    !end &&
    valid[UNEXPECTED_CHARACTER_START] &&
    (c ==
      ']' ||
      c ==
      '}' ||
      c ==
      ',' ||
      c ==
      ';' ||
      c ==
      '.' ||
      c ==
      '{' ||
      c ==
      '\\' ||
      control(c) ||
      (valid[EXPRESSION_END] &&
        !spaced &&
        !time_delimiter &&
        !number_continuation &&
        (c == '"' || c == '\'' || !scalar_boundary(c))))
  ) {
    if ((key_char || c == '"' || c == '\'') && keyval_ahead(lexer))
      return emit(lexer, valid, EXPRESSION_END);
    return emit(lexer, valid, UNEXPECTED_CHARACTER_START);
  }
  if (!end && valid[UNEXPECTED_CHARACTER]) {
    if (key_char) {
      do {
        lexer->advance(lexer, false);
      } while (key_character(lexer->lookahead));
      lexer->mark_end(lexer);
      return emit(lexer, valid, UNEXPECTED_CHARACTER);
    }
    return take(lexer, valid, UNEXPECTED_CHARACTER);
  }
  if (
    valid[EXPRESSION_END] &&
    (end ||
      (c !=
        '#' &&
        (spaced ||
          scalar_boundary(c) ||
          (!number_continuation && !time_delimiter))))
  )
    return emit(lexer, valid, EXPRESSION_END);
  if (!end && emit(lexer, valid, MISSING_NEWLINE))
    return true;
  return false;
}
