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
    {6, false},
    {7, false},
  };
  for (unsigned symbol = MLB_QUOTE; symbol < TOKEN_COUNT; symbol += 1) {
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

static void test_disabled_and_recovery_scans_do_not_consume_source(void) {
  const int32_t input[] = {'"', 'x'};
  for (unsigned enabled = 0; enabled <= 1; enabled += 1) {
    const bool valid_symbols[] = {enabled != 0, enabled != 0};
    struct MockLexer mock;
    init_mock_lexer(&mock, input, 2);
    assert(
      !tree_sitter_toml_external_scanner_scan(NULL, &mock.lexer, valid_symbols)
    );
    assert(mock.offset == 0);
    assert(mock.mark == SIZE_MAX);
  }
}

static void test_unrelated_characters_and_eof_are_not_quote_content(void) {
  const int32_t input[] = {'a', 0, 0x1f600, '"', '\''};
  for (unsigned symbol = MLB_QUOTE; symbol < TOKEN_COUNT; symbol += 1) {
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

int main(void) {
  test_stateless_lifecycle_and_serialization();
  test_quote_runs_preserve_content_and_closing_delimiters();
  test_disabled_and_recovery_scans_do_not_consume_source();
  test_unrelated_characters_and_eof_are_not_quote_content();
  return 0;
}
