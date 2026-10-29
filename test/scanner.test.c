#include <assert.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "../src/scanner.c"
#define COUNT(array) (sizeof(array) / sizeof((array)[0]))

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
  const bool valid_symbols[TOKEN_COUNT] = {false};
  struct MockLexer mock;
  init_mock_lexer(&mock, input, COUNT(input));
  assert(
    !tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid_symbols)
  );
  assert(mock.offset == 0);
  assert(mock.mark == SIZE_MAX);
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
    for (size_t index = 0; index < COUNT(input); index += 1) {
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

static void test_recovery_sentinel_does_not_select_a_context(void) {
  bool valid[TOKEN_COUNT];
  for (unsigned index = 0; index < TOKEN_COUNT; index++) valid[index] = true;
  const int32_t input[] = {'"', 'x'};
  struct MockLexer mock;
  init_mock_lexer(&mock, input, COUNT(input));
  assert(!tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid));
  assert(mock.offset == 0);
}

static void test_time_lookahead_preserves_digits_and_date_layout(void) {
  const struct {
    const char *input;
    bool space;
    bool accepted;
  } cases[] = {
    {"00:00", false, true},
    {"23:59", false, true},
    {"24:00", false, false},
    {"7:00", false, false},
    {"2026-01-01", false, false},
    {" 07:32", true, true},
    {"  #", true, false},
    {" ", true, false},
    {" 07", true, false},
    {" 24:00", true, false},
    {"", false, false},
  };
  for (size_t index = 0; index < COUNT(cases); index++) {
    int32_t input[16];
    const size_t length = strlen(cases[index].input);
    for (size_t offset = 0; offset < length; offset++)
      input[offset] = cases[index].input[offset];
    const enum TokenType token =
      cases[index].space ? DATE_SPACE : TIME_HOUR_START;
    bool valid[TOKEN_COUNT] = {false};
    valid[token] = true;
    struct MockLexer mock;
    init_mock_lexer(&mock, input, length);
    assert(
      tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid) ==
      cases[index].accepted
    );
    if (cases[index].accepted) {
      assert(mock.lexer.result_symbol == token);
      assert(mock.mark == (cases[index].space ? 1u : 0u));
    }
  }
}

static void test_text_tokens_reject_controls_and_surrogates(void) {
  const struct {
    int32_t value;
    bool accepted;
  } cases[] = {
    {'a', true},
    {'\t', true},
    {' ', true},
    {0xd7ff, true},
    {0xe000, true},
    {0xfffd, true},
    {0x10000, true},
    {0x10ffff, true},
    {0, false},
    {'\n', false},
    {'\r', false},
    {0x7f, false},
    {0xd800, false},
    {0xdfff, false},
    {0x110000, false},
    {-1, false},
  };
  for (unsigned symbol = BASIC_UNESCAPED; symbol <= LITERAL_CHAR; symbol++) {
    bool valid[TOKEN_COUNT] = {false};
    valid[symbol] = true;
    for (size_t index = 0; index < COUNT(cases); index++) {
      struct MockLexer mock;
      init_mock_lexer(&mock, &cases[index].value, 1);
      assert(
        tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid) ==
        cases[index].accepted
      );
      if (cases[index].accepted) {
        assert(mock.lexer.result_symbol == symbol);
        assert(mock.mark == 1);
      }
    }
  }
}

static void
test_comment_stops_before_invalid_source_and_continuation_space_wins(void) {
  const int32_t comment[] = {'#', 'x', 0xd800, 'y'};
  struct MockLexer mock;
  const bool comment_symbols[TOKEN_COUNT] = {[COMMENT] = true};
  init_mock_lexer(&mock, comment, COUNT(comment));
  assert(
    tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, comment_symbols)
  );
  assert(mock.mark == 2);
  assert(mock.lexer.result_symbol == COMMENT);

  const int32_t continuation[] = {' ', '\t', 'x'};
  const bool content_symbols[TOKEN_COUNT] = {
    [CONTINUATION_SPACE] = true,
    [BASIC_UNESCAPED] = true
  };
  init_mock_lexer(&mock, continuation, COUNT(continuation));
  assert(
    tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, content_symbols)
  );
  assert(mock.mark == 2);
  assert(mock.lexer.result_symbol == CONTINUATION_SPACE);
}

static void test_scanner_lifecycle_has_no_serialized_state(void) {
  void *scanner = tree_sitter_toml_external_scanner_create();
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  memset(buffer, 0x5a, sizeof(buffer));
  assert(tree_sitter_toml_external_scanner_serialize(scanner, buffer) == 0);
  for (size_t index = 0; index < sizeof(buffer); index++)
    assert(buffer[index] == 0x5a);
  tree_sitter_toml_external_scanner_deserialize(
    scanner,
    buffer,
    sizeof(buffer)
  );
  tree_sitter_toml_external_scanner_deserialize(scanner, NULL, 0);
  tree_sitter_toml_external_scanner_destroy(scanner);
}

int main(void) {
  test_scanner_lifecycle_has_no_serialized_state();
  test_quote_runs_preserve_content_and_closing_delimiters();
  test_disabled_scans_do_not_consume_source();
  test_quote_tokens_select_the_matching_delimiter();
  test_unrelated_characters_and_eof_are_not_quote_content();
  test_recovery_sentinel_does_not_select_a_context();
  test_time_lookahead_preserves_digits_and_date_layout();
  test_text_tokens_reject_controls_and_surrogates();
  test_comment_stops_before_invalid_source_and_continuation_space_wins();
  return 0;
}
