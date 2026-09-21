const sign = optional(choice("-", "+"));

const digit = ($, rule = $._digit) => alias(rule, $.digit);

const digits = (characters) =>
  choice(...Array.from(characters, (character) => new RegExp(character)));

const hexdig = ($) => alias($._hexdig, $.hexdig);

const times = (count, leaf) => Array(count).fill(leaf);

const underscored = (leaf) => choice(leaf, seq("_", leaf));

const separated = (leaf) => seq(leaf, repeat(underscored(leaf)));

const layout = ($) => optional($._ws_comment_newline);

const elements = ($, element) =>
  seq(
    layout($),
    element,
    repeat(seq(layout($), ",", layout($), element)),
    optional(seq(layout($), ",")),
  );

const header = ($, open, close) =>
  seq(open, optional($._ws), field("key", $.key), optional($._ws), close);

const multiline = ($, delimiter, body) =>
  prec(1, seq(delimiter, optional($.newline), optional(body), delimiter));

const quotes = (quote, mark) =>
  prec.right(seq(alias(quote, mark), optional(alias(quote, mark))));

export default grammar({
  name: "toml",
  extras: () => [],
  externals: ($) => [$._mlb_quote, $._mll_quote],
  conflicts: ($) => [
    [$.key, $.dotted_key],
    [$.dotted_key],
    [$.unsigned_dec_int, $._digit],
    [$._digit, $.time_hour],
    [$._digit1_9, $.time_hour],
    [$.offset_date_time, $.local_date_time, $.local_date],
    [$.array_values],
    [$.inline_table_keyvals],
  ],
  rules: {
    toml: ($) =>
      seq(
        optional($.expression),
        repeat(seq($.newline, optional($.expression))),
      ),
    expression: ($) =>
      choice(
        $._ws,
        seq(optional($._ws), $.comment),
        seq(
          optional($._ws),
          choice($.keyval, $.table),
          optional($._ws),
          optional($.comment),
        ),
      ),
    _ws: ($) => prec.right(repeat1(choice($._space, /\t/))),
    _space: () => / /,
    newline: () => /\r?\n/,
    comment: () => /#[\t\x20-\x7e\u0080-\u{d7ff}\u{e000}-\u{10ffff}]*/u,
    keyval: ($) =>
      seq(
        field("key", $.key),
        optional($._ws),
        "=",
        optional($._ws),
        field("value", $.val),
      ),
    key: ($) => choice($.simple_key, $.dotted_key),
    simple_key: ($) => choice($.quoted_key, $.unquoted_key),
    unquoted_key: () => /[A-Za-z0-9_-]+/,
    quoted_key: ($) => choice($.basic_string, $.literal_string),
    dotted_key: ($) =>
      seq(
        $.simple_key,
        repeat1(seq(optional($._ws), ".", optional($._ws), $.simple_key)),
      ),
    val: ($) =>
      choice(
        $.string,
        $.boolean,
        $.array,
        $.inline_table,
        $.date_time,
        $.float,
        $.integer,
      ),
    string: ($) =>
      choice(
        $.ml_basic_string,
        $.basic_string,
        $.ml_literal_string,
        $.literal_string,
      ),
    basic_string: ($) => seq('"', repeat($.basic_char), '"'),
    basic_char: ($) => choice($.basic_unescaped, $.escaped),
    basic_unescaped: () =>
      /[\t\x20-\x21\x23-\x5b\x5d-\x7e\u0080-\u{d7ff}\u{e000}-\u{10ffff}]/u,
    escaped: ($) => seq("\\", $.escape_seq_char),
    escape_seq_char: ($) =>
      choice(
        '"',
        "\\",
        "b",
        "e",
        "f",
        "n",
        "r",
        "t",
        seq("x", ...times(2, hexdig($))),
        seq("u", ...times(4, hexdig($))),
        seq("U", ...times(8, hexdig($))),
      ),
    ml_basic_string: ($) => multiline($, '"""', $.ml_basic_body),
    ml_basic_body: ($) => repeat1(choice($.mlb_content, $.mlb_quotes)),
    mlb_content: ($) => choice($.basic_char, $.newline, $.mlb_escaped_nl),
    mlb_quotes: ($) => quotes($._mlb_quote, '"'),
    mlb_escaped_nl: ($) =>
      prec.right(
        seq("\\", optional($._ws), $.newline, repeat(choice($._ws, $.newline))),
      ),
    literal_string: ($) => seq("'", repeat($.literal_char), "'"),
    literal_char: () =>
      /[\t\x20-\x26\x28-\x7e\u0080-\u{d7ff}\u{e000}-\u{10ffff}]/u,
    ml_literal_string: ($) => multiline($, "'''", $.ml_literal_body),
    ml_literal_body: ($) => repeat1(choice($.mll_content, $.mll_quotes)),
    mll_content: ($) => choice($.literal_char, $.newline),
    mll_quotes: ($) => quotes($._mll_quote, "'"),
    integer: ($) => choice($.dec_int, $.hex_int, $.oct_int, $.bin_int),
    dec_int: ($) => seq(sign, $.unsigned_dec_int),
    unsigned_dec_int: ($) =>
      choice(
        digit($),
        seq(alias($._digit1_9, $.digit1_9), repeat1(underscored(digit($)))),
      ),
    hex_int: ($) => seq("0x", separated(hexdig($))),
    oct_int: ($) => seq("0o", separated(alias($._digit0_7, $.digit0_7))),
    bin_int: ($) => seq("0b", separated(alias($._digit0_1, $.digit0_1))),
    _digit: ($) => choice(/0/, $._digit1_9),
    _digit1_9: () => digits("123456789"),
    _digit0_7: () => /[0-7]/,
    _digit0_1: () => /[01]/,
    _hexdig: ($) => choice($._digit, /[A-Fa-f]/),
    float: ($) =>
      choice(
        seq($.float_int_part, choice($.exp, seq($.frac, optional($.exp)))),
        $.special_float,
      ),
    float_int_part: ($) => $.dec_int,
    frac: ($) => seq(".", $.zero_prefixable_int),
    zero_prefixable_int: ($) => separated(digit($)),
    exp: ($) => seq(choice("e", "E"), $.float_exp_part),
    float_exp_part: ($) => seq(sign, $.zero_prefixable_int),
    special_float: () => seq(sign, choice("inf", "nan")),
    boolean: () => choice("true", "false"),
    date_time: ($) =>
      choice($.offset_date_time, $.local_date_time, $.local_date, $.local_time),
    date_fullyear: ($) => seq(...times(4, digit($))),
    date_month: ($) =>
      choice(
        seq(digit($, /0/), digit($, $._digit1_9)),
        seq(digit($, /1/), digit($, digits("012"))),
      ),
    date_mday: ($) =>
      choice(
        seq(digit($, /0/), digit($, $._digit1_9)),
        seq(digit($, digits("12")), digit($)),
        seq(digit($, /3/), digit($, digits("01"))),
      ),
    time_delim: ($) => choice("T", "t", alias($._space, " ")),
    time_hour: ($) =>
      choice(
        seq(digit($, digits("01")), digit($)),
        seq(digit($, /2/), digit($, digits("0123"))),
      ),
    time_minute: ($) => seq(digit($, digits("012345")), digit($)),
    time_second: ($) =>
      choice(
        seq(digit($, digits("012345")), digit($)),
        seq(digit($, /6/), digit($, /0/)),
      ),
    time_secfrac: ($) => seq(".", repeat1(digit($))),
    time_numoffset: ($) =>
      seq(choice("+", "-"), $.time_hour, ":", $.time_minute),
    time_offset: ($) => choice("Z", "z", $.time_numoffset),
    partial_time: ($) =>
      seq(
        $.time_hour,
        ":",
        $.time_minute,
        optional(seq(":", $.time_second, optional($.time_secfrac))),
      ),
    full_date: ($) => seq($.date_fullyear, "-", $.date_month, "-", $.date_mday),
    full_time: ($) => seq($.partial_time, $.time_offset),
    offset_date_time: ($) => seq($.full_date, $.time_delim, $.full_time),
    local_date_time: ($) => seq($.full_date, $.time_delim, $.partial_time),
    local_date: ($) => $.full_date,
    local_time: ($) => $.partial_time,
    array: ($) => seq("[", optional($.array_values), layout($), "]"),
    array_values: ($) => elements($, $.val),
    _ws_comment_newline: ($) =>
      repeat1(choice($._ws, $.newline, seq($.comment, $.newline))),
    table: ($) => choice($.std_table, $.array_table),
    std_table: ($) => header($, "[", "]"),
    inline_table: ($) =>
      seq("{", optional($.inline_table_keyvals), layout($), "}"),
    inline_table_keyvals: ($) => elements($, $.keyval),
    array_table: ($) => header($, "[[", "]]"),
  },
});
