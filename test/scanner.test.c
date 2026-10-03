#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "../src/scanner.c"

struct MockLexer {
  TSLexer lexer;
  const int32_t *input;
  size_t length;
  size_t offset;
  size_t mark;
};

static void mock_advance(TSLexer *lexer, bool skip) {
  (void)skip;
  struct MockLexer *mock = (struct MockLexer *)lexer;
  if (mock->offset < mock->length) {
    mock->offset += 1;
  }
  lexer->lookahead =
    mock->offset < mock->length ? mock->input[mock->offset] : 0;
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
        .eof = mock_eof,
      },
    .input = input,
    .length = length,
    .mark = SIZE_MAX,
  };
}

static void test_stateless_lifecycle_and_serialization(void) {
  void *scanner = tree_sitter_toml_external_scanner_create();
  assert(scanner == NULL);
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  memset(buffer, 0x5a, sizeof(buffer));
  assert(tree_sitter_toml_external_scanner_serialize(scanner, buffer) == 0);
  for (size_t index = 0; index < sizeof(buffer); index += 1) {
    assert(buffer[index] == 0x5a);
  }
  tree_sitter_toml_external_scanner_deserialize(scanner, NULL, 0);
  tree_sitter_toml_external_scanner_deserialize(
    scanner,
    buffer,
    sizeof(buffer)
  );
  tree_sitter_toml_external_scanner_destroy(scanner);
}

static void test_quote_runs_preserve_content_and_closing_delimiters(void) {
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
    {7, true},
  };
  for (unsigned symbol = MLB_QUOTE; symbol <= MLL_QUOTE; symbol += 1) {
    bool valid_symbols[TOKEN_COUNT] = {false};
    valid_symbols[symbol] = true;
    for (
      size_t index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1
    ) {
      int32_t input[8];
      for (size_t offset = 0; offset < cases[index].length; offset += 1) {
        input[offset] = symbol == MLB_QUOTE ? '"' : '\'';
      }
      input[cases[index].length] = 'x';
      for (size_t suffix = 0; suffix <= 1; suffix += 1) {
        struct MockLexer mock;
        init_mock_lexer(&mock, input, cases[index].length + suffix);
        assert(
          tree_sitter_toml_external_scanner_scan(
            NULL,
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
  const bool valid_symbols[TOKEN_COUNT] = {false, false};
  struct MockLexer mock;
  init_mock_lexer(&mock, input, 2);
  assert(
    !tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid_symbols)
  );
  assert(mock.offset == 0);
  assert(mock.mark == 0);
}

static void test_quote_tokens_select_the_matching_delimiter(void) {
  const bool valid_symbols[TOKEN_COUNT] = {true, true};
  const struct {
    int32_t quote;
    unsigned symbol;
  } cases[] = {{'"', MLB_QUOTE}, {'\'', MLL_QUOTE}};
  for (size_t index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1) {
    const int32_t input[] = {cases[index].quote, 'x'};
    struct MockLexer mock;
    init_mock_lexer(&mock, input, 2);
    assert(
      tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid_symbols)
    );
    assert(mock.lexer.result_symbol == cases[index].symbol);
    assert(mock.mark == 1);
  }
}

static void test_unrelated_characters_and_eof_are_not_quote_content(void) {
  const int32_t input[] = {'a', 0, 0x1f600, '"', '\''};
  for (unsigned symbol = MLB_QUOTE; symbol <= MLL_QUOTE; symbol += 1) {
    bool valid_symbols[TOKEN_COUNT] = {false};
    valid_symbols[symbol] = true;
    for (
      size_t index = 0; index < sizeof(input) / sizeof(input[0]); index += 1
    ) {
      if (input[index] == (symbol == MLB_QUOTE ? '"' : '\'')) {
        continue;
      }
      struct MockLexer mock;
      init_mock_lexer(&mock, input + index, 1);
      assert(!tree_sitter_toml_external_scanner_scan(
        NULL,
        &mock.lexer,
        valid_symbols
      ));
      assert(mock.offset == 0);
    }
    struct MockLexer mock;
    init_mock_lexer(&mock, NULL, 0);
    assert(
      !tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid_symbols)
    );
    assert(mock.offset == 0);
  }
}

static void test_recovery_sentinel_does_not_emit_issue_tokens(void) {
  bool valid[TOKEN_COUNT];
  for (unsigned index = 0; index < TOKEN_COUNT; index++)
    valid[index] = true;
  const int32_t input[] = {'"', 'x'};
  struct MockLexer mock;
  init_mock_lexer(&mock, input, 2);
  assert(!tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid));
  assert(mock.offset == 0);
}

static void test_missing_value_distinguishes_eof_from_line_boundary(void) {
  bool valid[TOKEN_COUNT] = {false};
  valid[INVALID_MISSING_VALUE] = true;
  valid[INCOMPLETE_MISSING_VALUE] = true;
  const int32_t input[] = {'\n'};
  struct MockLexer mock;
  init_mock_lexer(&mock, input, 0);
  assert(tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid));
  assert(mock.lexer.result_symbol == INCOMPLETE_MISSING_VALUE);
  assert(mock.mark == 0);
  init_mock_lexer(&mock, input, 1);
  assert(tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid));
  assert(mock.lexer.result_symbol == INVALID_MISSING_VALUE);
  assert(mock.mark == 0);
}

static void test_nul_is_a_character_and_eof_is_not_consumed(void) {
  bool valid[TOKEN_COUNT] = {false};
  valid[INVALID_CHARACTER] = true;
  const int32_t input[] = {0};
  struct MockLexer mock;
  init_mock_lexer(&mock, input, 1);
  assert(tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid));
  assert(mock.lexer.result_symbol == INVALID_CHARACTER);
  assert(mock.mark == 1);
  init_mock_lexer(&mock, input, 0);
  assert(!tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid));
  assert(mock.offset == 0);
}

static void test_scalar_markers_preserve_source_and_real_terminators(void) {
  const struct {
    int32_t input[12];
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
  };
  bool valid[TOKEN_COUNT] = {false};
  valid[INTEGER_START] = valid[FLOAT_START] = valid[DATE_START] = true;
  valid[INVALID_VALUE] = valid[INCOMPLETE_VALUE] = true;
  for (size_t index = 0; index < sizeof(cases) / sizeof(cases[0]); index++) {
    struct MockLexer mock;
    init_mock_lexer(&mock, cases[index].input, cases[index].length);
    assert(tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid));
    assert(mock.lexer.result_symbol == cases[index].token);
    assert(mock.mark == cases[index].end);
  }
}

static void test_long_date_elements_do_not_overflow_lookahead(void) {
  int32_t input[4096];
  for (size_t index = 0; index < sizeof(input) / sizeof(input[0]); index++)
    input[index] = '9';
  bool valid[TOKEN_COUNT] = {false};
  valid[DATE_MONTH_START] = valid[INVALID_DATE_MONTH] =
    valid[INCOMPLETE_DATE_MONTH] = true;
  struct MockLexer mock;
  init_mock_lexer(&mock, input, sizeof(input) / sizeof(input[0]));
  assert(tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid));
  assert(mock.lexer.result_symbol == INVALID_DATE_MONTH);
  assert(mock.mark == 0);
  assert(mock.offset == sizeof(input) / sizeof(input[0]));
}

int main(void) {
  test_stateless_lifecycle_and_serialization();
  test_quote_runs_preserve_content_and_closing_delimiters();
  test_disabled_scans_do_not_consume_source();
  test_quote_tokens_select_the_matching_delimiter();
  test_unrelated_characters_and_eof_are_not_quote_content();
  test_recovery_sentinel_does_not_emit_issue_tokens();
  test_missing_value_distinguishes_eof_from_line_boundary();
  test_nul_is_a_character_and_eof_is_not_consumed();
  test_scalar_markers_preserve_source_and_real_terminators();
  test_long_date_elements_do_not_overflow_lookahead();
  return 0;
}
