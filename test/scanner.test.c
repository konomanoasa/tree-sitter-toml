#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "../src/scanner.c"

#define COUNT(array) (sizeof(array) / sizeof((array)[0]))

#ifdef TREE_SITTER_REUSE_ALLOCATOR
void *(*ts_current_malloc)(size_t) = malloc;
void *(*ts_current_calloc)(size_t, size_t) = calloc;
void *(*ts_current_realloc)(void *, size_t) = realloc;
void (*ts_current_free)(void *) = free;
#endif

struct MockLexer {
  TSLexer lexer;
  const int32_t *input;
  size_t length;
  size_t offset;
  size_t mark;
  size_t advances;
};

static void mock_advance(TSLexer *lexer, bool skip) {
  (void)skip;
  struct MockLexer *mock = (struct MockLexer *)lexer;
  mock->advances++;
  if (mock->offset < mock->length) {
    mock->offset += 1;
  }
  lexer->lookahead =
    mock->offset < mock->length ? mock->input[mock->offset] : 0;
}

static bool mock_included_range_start(const TSLexer *lexer) {
  (void)lexer;
  return false;
}

static void mock_mark_end(TSLexer *lexer) {
  struct MockLexer *mock = (struct MockLexer *)lexer;
  mock->mark = mock->offset;
}

static bool mock_eof(const TSLexer *lexer) {
  const struct MockLexer *mock = (const struct MockLexer *)lexer;
  return mock->offset == mock->length;
}

static void
init_mock_lexer(struct MockLexer *mock, const int32_t *input, size_t length) {
  *mock = (struct MockLexer){
    .lexer =
      {
        .lookahead = length == 0 ? 0 : input[0],
        .result_symbol = UINT16_MAX,
        .advance = mock_advance,
        .mark_end = mock_mark_end,
        .is_at_included_range_start = mock_included_range_start,
        .eof = mock_eof,
      },
    .input = input,
    .length = length,
    .mark = SIZE_MAX,
  };
}

static void test_lifecycle_and_serialization(void) {
  const unsigned char untouched_byte = 0x5a;
  struct Scanner *scanner = tree_sitter_toml_external_scanner_create();
  assert(scanner != NULL);
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  memset(buffer, untouched_byte, sizeof(buffer));
  assert(tree_sitter_toml_external_scanner_serialize(scanner, buffer) == 0);
  for (size_t index = 0; index < sizeof(buffer); index += 1) {
    assert(buffer[index] == untouched_byte);
  }
  tree_sitter_toml_external_scanner_deserialize(scanner, NULL, 0);
  scanner->rejected_key = REJECTED_KEY;
  scanner->word_continuation = true;
  scanner->arrays = UINT32_C(0x12345678);
  scanner->inline_tables = UINT32_C(0x9abcdef0);
  const unsigned char expected[] =
    {5, 0x78, 0x56, 0x34, 0x12, 0xf0, 0xde, 0xbc, 0x9a};
  assert(
    tree_sitter_toml_external_scanner_serialize(scanner, buffer) ==
    sizeof(expected)
  );
  assert(memcmp(buffer, expected, sizeof(expected)) == 0);
  tree_sitter_toml_external_scanner_deserialize(scanner, NULL, 0);
  assert(scanner->rejected_key == NO_REJECTED_KEY);
  assert(!scanner->word_continuation);
  assert(scanner->arrays == 0);
  assert(scanner->inline_tables == 0);
  tree_sitter_toml_external_scanner_deserialize(
    scanner,
    buffer,
    sizeof(expected)
  );
  assert(scanner->rejected_key == REJECTED_KEY);
  assert(scanner->word_continuation);
  assert(scanner->arrays == UINT32_C(0x12345678));
  assert(scanner->inline_tables == UINT32_C(0x9abcdef0));
  tree_sitter_toml_external_scanner_destroy(scanner);
}

#ifdef TREE_SITTER_REUSE_ALLOCATOR
static void *failing_calloc(size_t count, size_t size) {
  (void)count;
  (void)size;
  return NULL;
}

static void test_failed_creation_allows_every_scanner_callback(void) {
  const unsigned char untouched_byte = 0x5a;
  ts_current_calloc = failing_calloc;
  void *scanner = tree_sitter_toml_external_scanner_create();
  ts_current_calloc = calloc;
  assert(scanner == NULL);
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  memset(buffer, untouched_byte, sizeof(buffer));
  assert(tree_sitter_toml_external_scanner_serialize(scanner, buffer) == 0);
  for (size_t index = 0; index < sizeof(buffer); index += 1) {
    assert(buffer[index] == untouched_byte);
  }
  tree_sitter_toml_external_scanner_deserialize(scanner, NULL, 0);
  tree_sitter_toml_external_scanner_deserialize(scanner, buffer, 9);
  const bool valid_symbols[TOKEN_COUNT] = {[ARRAY_OPEN] = true};
  const int32_t input[] = {'['};
  struct MockLexer mock;
  init_mock_lexer(&mock, input, COUNT(input));
  assert(
    !tree_sitter_toml_external_scanner_scan(scanner, &mock.lexer, valid_symbols)
  );
  assert(mock.offset == 0);
  tree_sitter_toml_external_scanner_destroy(scanner);
}
#endif

static void test_quote_runs_preserve_content_and_closing_delimiters(void) {
  enum { MAX_QUOTE_RUN = 7 };
  const struct {
    size_t length;
    bool accepted;
  } cases[] = {
    {1, true},
    {2, true},
    {3, false},
    {4, true},
    {5, true},
    {6, true},
    {MAX_QUOTE_RUN, true},
  };
  for (unsigned symbol = MLB_QUOTE; symbol <= MLL_QUOTE; symbol += 1) {
    bool valid_symbols[TOKEN_COUNT] = {false};
    valid_symbols[symbol] = true;
    for (size_t index = 0; index < COUNT(cases); index += 1) {
      int32_t input[MAX_QUOTE_RUN + 1];
      for (size_t offset = 0; offset < cases[index].length; offset += 1) {
        input[offset] = symbol == MLB_QUOTE ? '"' : '\'';
      }
      input[cases[index].length] = 'x';
      for (size_t suffix = 0; suffix <= 1; suffix += 1) {
        struct MockLexer mock;
        init_mock_lexer(&mock, input, cases[index].length + suffix);
        assert(
          tree_sitter_toml_external_scanner_scan(
            &(struct Scanner){0},
            &mock.lexer,
            valid_symbols
          ) == cases[index].accepted
        );
        if (cases[index].accepted) {
          assert(mock.lexer.result_symbol == symbol);
          assert(mock.mark == 1);
        }
      }
    }
  }
}

static void test_disabled_scans_do_not_consume_source(void) {
  const int32_t input[] = {'"', 'x'};
  const bool valid_symbols[TOKEN_COUNT] = {false};
  struct MockLexer mock;
  init_mock_lexer(&mock, input, COUNT(input));
  assert(!tree_sitter_toml_external_scanner_scan(
    &(struct Scanner){0},
    &mock.lexer,
    valid_symbols
  ));
  assert(mock.offset == 0);
  assert(mock.mark == 0);
}

static void test_quote_tokens_select_the_matching_delimiter(void) {
  const bool valid_symbols[TOKEN_COUNT] = {
    [MLB_QUOTE] = true,
    [MLL_QUOTE] = true
  };
  const struct {
    int32_t quote;
    unsigned symbol;
  } cases[] = {{'"', MLB_QUOTE}, {'\'', MLL_QUOTE}};
  for (size_t index = 0; index < COUNT(cases); index += 1) {
    const int32_t input[] = {cases[index].quote, 'x'};
    struct MockLexer mock;
    init_mock_lexer(&mock, input, COUNT(input));
    assert(tree_sitter_toml_external_scanner_scan(
      &(struct Scanner){0},
      &mock.lexer,
      valid_symbols
    ));
    assert(mock.lexer.result_symbol == cases[index].symbol);
    assert(mock.mark == 1);
  }
}

static void test_unrelated_characters_and_eof_are_not_quote_content(void) {
  const int32_t input[] = {'a', 0, 0x1f600, '"', '\''};
  for (unsigned symbol = MLB_QUOTE; symbol <= MLL_QUOTE; symbol += 1) {
    bool valid_symbols[TOKEN_COUNT] = {false};
    valid_symbols[symbol] = true;
    for (size_t index = 0; index < COUNT(input); index += 1) {
      if (input[index] == (symbol == MLB_QUOTE ? '"' : '\'')) {
        continue;
      }
      struct MockLexer mock;
      init_mock_lexer(&mock, input + index, 1);
      assert(!tree_sitter_toml_external_scanner_scan(
        &(struct Scanner){0},
        &mock.lexer,
        valid_symbols
      ));
      assert(mock.offset == 0);
    }
    struct MockLexer mock;
    init_mock_lexer(&mock, NULL, 0);
    assert(!tree_sitter_toml_external_scanner_scan(
      &(struct Scanner){0},
      &mock.lexer,
      valid_symbols
    ));
    assert(mock.offset == 0);
  }
}

static void test_recovery_sentinel_does_not_emit_issue_tokens(void) {
  bool valid[TOKEN_COUNT];
  for (unsigned index = 0; index < TOKEN_COUNT; index++) valid[index] = true;
  const int32_t input[] = {'"', 'x'};
  struct MockLexer mock;
  init_mock_lexer(&mock, input, COUNT(input));
  assert(!tree_sitter_toml_external_scanner_scan(
    &(struct Scanner){0},
    &mock.lexer,
    valid
  ));
  assert(mock.offset == 0);
}

static void test_missing_value_distinguishes_eof_from_line_boundary(void) {
  bool valid[TOKEN_COUNT] = {false};
  valid[INVALID_MISSING_VALUE] = true;
  valid[INCOMPLETE_MISSING_VALUE] = true;
  const int32_t input[] = {'\n'};
  struct MockLexer mock;
  init_mock_lexer(&mock, input, 0);
  assert(tree_sitter_toml_external_scanner_scan(
    &(struct Scanner){0},
    &mock.lexer,
    valid
  ));
  assert(mock.lexer.result_symbol == INCOMPLETE_MISSING_VALUE);
  assert(mock.mark == 0);
  init_mock_lexer(&mock, input, COUNT(input));
  assert(tree_sitter_toml_external_scanner_scan(
    &(struct Scanner){0},
    &mock.lexer,
    valid
  ));
  assert(mock.lexer.result_symbol == INVALID_MISSING_VALUE);
  assert(mock.mark == 0);
}

static void test_nul_is_a_character_and_eof_is_not_consumed(void) {
  bool valid[TOKEN_COUNT] = {false};
  valid[INVALID_CHARACTER] = true;
  const int32_t input[] = {0};
  struct MockLexer mock;
  init_mock_lexer(&mock, input, COUNT(input));
  assert(tree_sitter_toml_external_scanner_scan(
    &(struct Scanner){0},
    &mock.lexer,
    valid
  ));
  assert(mock.lexer.result_symbol == INVALID_CHARACTER);
  assert(mock.mark == 1);
  init_mock_lexer(&mock, input, 0);
  assert(!tree_sitter_toml_external_scanner_scan(
    &(struct Scanner){0},
    &mock.lexer,
    valid
  ));
  assert(mock.offset == 0);
}

static void test_scalar_markers_preserve_source_and_real_terminators(void) {
  enum { MAX_SCALAR_CHARACTERS = 10 };
  const struct {
    int32_t input[MAX_SCALAR_CHARACTERS];
    size_t length;
    enum TokenType token;
    size_t end;
  } cases[] = {
    {{'1', '2', '3'}, 3, INTEGER_START, 0},
    {{'1', '.', '2'}, 3, FLOAT_START, 0},
    {{'2', '0', '2', '6', '-', '0', '1', '-', '0', '1'}, 10, DATE_START, 0},
    {{'1', '2', ':', '3', '4'}, 5, DATE_START, 0},
    {{'t', 'r', 'u'}, 3, INCOMPLETE_VALUE, 3},
    {{'t', 'r', 'u', ']'}, 4, INVALID_VALUE, 3},
    {{'4', '+', 'e'}, 3, FLOAT_START, 0},
    {{'-', 'e', '5'}, 3, FLOAT_START, 0},
    {{'-', '?', 'e', '5'}, 4, INTEGER_START, 0},
    {{'4', '-', 'e'}, 3, INTEGER_START, 0},
    {{'4', '-', '=', 'e'}, 4, INTEGER_START, 0},
    {{'4', '=', '-', 'e'}, 4, INTEGER_START, 0},
    {{'4', '-', '_', 'e'}, 4, INTEGER_START, 0},
    {{'4', '+', '_', 'e'}, 4, FLOAT_START, 0},
  };
  bool valid[TOKEN_COUNT] = {false};
  valid[INTEGER_START] = valid[FLOAT_START] = valid[DATE_START] = true;
  valid[INVALID_VALUE] = valid[INCOMPLETE_VALUE] = true;
  for (size_t index = 0; index < COUNT(cases); index++) {
    struct MockLexer mock;
    init_mock_lexer(&mock, cases[index].input, cases[index].length);
    assert(tree_sitter_toml_external_scanner_scan(
      &(struct Scanner){0},
      &mock.lexer,
      valid
    ));
    assert(mock.lexer.result_symbol == cases[index].token);
    assert(mock.mark == cases[index].end);
  }
}

static void test_long_date_elements_do_not_overflow_lookahead(void) {
  enum { DIGIT_COUNT = 4096 };
  int32_t input[DIGIT_COUNT];
  for (size_t index = 0; index < COUNT(input); index++) input[index] = '9';
  bool valid[TOKEN_COUNT] = {false};
  valid[DATE_MONTH_START] = valid[INVALID_DATE_MONTH] =
    valid[INCOMPLETE_DATE_MONTH] = true;
  struct MockLexer mock;
  init_mock_lexer(&mock, input, COUNT(input));
  assert(tree_sitter_toml_external_scanner_scan(
    &(struct Scanner){0},
    &mock.lexer,
    valid
  ));
  assert(mock.lexer.result_symbol == INVALID_DATE_MONTH);
  assert(mock.mark == 0);
  assert(mock.offset == COUNT(input));
}

static void test_date_end_and_space_markers_are_zero_width(void) {
  enum { MAX_LOOKAHEAD_CHARACTERS = 4 };
  const struct {
    int32_t input[MAX_LOOKAHEAD_CHARACTERS];
    size_t length;
    bool accepted;
    enum TokenType token;
  } cases[] = {
    {{' ', '0', '7', ':'}, 4, true, DATE_SPACE},
    {{' ', '7'}, 2, true, DATE_SPACE},
    {{' ', '0', '7', 'x'}, 4, true, DATE_END},
    {{' ', 'x'}, 2, true, DATE_END},
    {{' '}, 1, true, DATE_END},
    {{'\t'}, 1, true, DATE_END},
    {{'x'}, 1, true, DATE_END},
    {{0}, 0, true, DATE_END},
    {{'T'}, 1, false, DATE_END},
    {{'t'}, 1, false, DATE_END},
  };
  bool valid[TOKEN_COUNT] = {false};
  valid[DATE_SPACE] = valid[DATE_END] = true;
  for (size_t index = 0; index < COUNT(cases); index++) {
    struct MockLexer mock;
    init_mock_lexer(&mock, cases[index].input, cases[index].length);
    assert(
      tree_sitter_toml_external_scanner_scan(
        &(struct Scanner){0},
        &mock.lexer,
        valid
      ) == cases[index].accepted
    );
    if (cases[index].accepted) {
      assert(mock.lexer.result_symbol == cases[index].token);
      assert(mock.mark == 0);
    }
  }
}

static void test_number_end_requires_an_adjacent_assignment(void) {
  enum { MAX_ASSIGNMENT_CHARACTERS = 4 };
  const struct {
    int32_t input[MAX_ASSIGNMENT_CHARACTERS];
    size_t length;
    bool expression;
    enum TokenType token;
  } cases[] = {
    {{'x', '=', '2'}, 3, true, NUMBER_END},
    {{'_', 'x', '=', '2'}, 4, true, NUMBER_END},
    {{'_', '=', '2'}, 3, true, NUMBER_END},
    {{'_', '2', '=', '3'}, 4, true, DEC_CONTINUATION},
    {{'x', '2'}, 2, true, DEC_CONTINUATION},
    {{'x', '=', '2'}, 3, false, DEC_CONTINUATION},
  };
  for (size_t index = 0; index < COUNT(cases); index++) {
    bool valid[TOKEN_COUNT] = {false};
    valid[DEC_CONTINUATION] = valid[NUMBER_END] = true;
    valid[EXPRESSION_END] = cases[index].expression;
    struct MockLexer mock;
    init_mock_lexer(&mock, cases[index].input, cases[index].length);
    assert(tree_sitter_toml_external_scanner_scan(
      &(struct Scanner){0},
      &mock.lexer,
      valid
    ));
    assert(mock.lexer.result_symbol == cases[index].token);
    assert(mock.mark == 0);
  }
}

static void test_exponent_start_yields_to_an_adjacent_assignment(void) {
  enum { MAX_ASSIGNMENT_CHARACTERS = 4 };
  const struct {
    int32_t input[MAX_ASSIGNMENT_CHARACTERS];
    size_t length;
    enum TokenType token;
  } cases[] = {
    {{'e', '5'}, 2, EXPONENT_START},
    {{'e', '=', '5'}, 3, EXPRESSION_END},
    {{'e', ' ', '=', '5'}, 4, EXPRESSION_END},
  };
  bool valid[TOKEN_COUNT] = {false};
  valid[EXPONENT_START] = valid[EXPRESSION_END] = true;
  for (size_t index = 0; index < COUNT(cases); index++) {
    struct MockLexer mock;
    init_mock_lexer(&mock, cases[index].input, cases[index].length);
    assert(tree_sitter_toml_external_scanner_scan(
      &(struct Scanner){0},
      &mock.lexer,
      valid
    ));
    assert(mock.lexer.result_symbol == cases[index].token);
    assert(mock.mark == 0);
  }
}

static void
assert_rejected_chain_is_linear(const int32_t *segment, size_t size) {
  enum { INPUT_CHARACTER_COUNT = 640, ADVANCES_PER_CHARACTER_LIMIT = 4 };
  int32_t input[INPUT_CHARACTER_COUNT];
  const int32_t separator[] = {' ', '.'};
  const size_t separator_length = COUNT(separator);
  size_t length = 0;
  while (length + size + separator_length <= INPUT_CHARACTER_COUNT) {
    if (length > 0) {
      for (size_t index = 0; index < separator_length; index++)
        input[length++] = separator[index];
    }
    for (size_t index = 0; index < size; index++)
      input[length++] = segment[index];
  }
  const bool marker[TOKEN_COUNT] = {
    [UNEXPECTED_CHARACTER_START] = true,
    [UNEXPECTED_CHARACTER_CONTINUATION] = true,
    [EXPRESSION_END] = true,
  };
  const bool characters[TOKEN_COUNT] = {[UNEXPECTED_CHARACTER] = true};
  struct MockLexer mock;
  struct Scanner scanner = {0};
  init_mock_lexer(&mock, input, length);
  size_t position = 0, advances = 0;
  while (position < length) {
    mock.offset = position;
    mock.lexer.lookahead = input[position];
    mock.advances = 0;
    assert(
      tree_sitter_toml_external_scanner_scan(&scanner, &mock.lexer, marker)
    );
    assert(
      mock.lexer.result_symbol == UNEXPECTED_CHARACTER_START ||
      mock.lexer.result_symbol == UNEXPECTED_CHARACTER_CONTINUATION
    );
    advances += mock.advances;
    position = mock.mark;
    mock.offset = position;
    mock.lexer.lookahead = input[position];
    mock.advances = 0;
    assert(
      tree_sitter_toml_external_scanner_scan(&scanner, &mock.lexer, characters)
    );
    assert(mock.lexer.result_symbol == UNEXPECTED_CHARACTER);
    assert(mock.mark > position);
    advances += mock.advances;
    position = mock.mark;
  }
  assert(advances < length * ADVANCES_PER_CHARACTER_LIMIT);
}

static void test_rejected_dotted_keys_do_not_repeat_suffix_lookahead(void) {
  assert_rejected_chain_is_linear((const int32_t[]){'x'}, 1);
  assert_rejected_chain_is_linear((const int32_t[]){'"', 'x', '"'}, 3);
  assert_rejected_chain_is_linear((const int32_t[]){'.', 'x', '.'}, 3);
  assert_rejected_chain_is_linear((const int32_t[]){'.'}, 1);
}

int main(void) {
  test_lifecycle_and_serialization();
#ifdef TREE_SITTER_REUSE_ALLOCATOR
  test_failed_creation_allows_every_scanner_callback();
#endif
  test_quote_runs_preserve_content_and_closing_delimiters();
  test_disabled_scans_do_not_consume_source();
  test_quote_tokens_select_the_matching_delimiter();
  test_unrelated_characters_and_eof_are_not_quote_content();
  test_recovery_sentinel_does_not_emit_issue_tokens();
  test_missing_value_distinguishes_eof_from_line_boundary();
  test_nul_is_a_character_and_eof_is_not_consumed();
  test_scalar_markers_preserve_source_and_real_terminators();
  test_long_date_elements_do_not_overflow_lookahead();
  test_date_end_and_space_markers_are_zero_width();
  test_number_end_requires_an_adjacent_assignment();
  test_exponent_start_yields_to_an_adjacent_assignment();
  test_rejected_dotted_keys_do_not_repeat_suffix_lookahead();
  return 0;
}
