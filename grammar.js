const digit = ($, rule = $._digit) => alias(rule, $.digit);
const hexdig = ($, rule = $._hexdig) => alias(rule, $.hexdig);
const times = (count, rule) => Array(count).fill(rule);
const digits = (leaf) => seq(leaf, repeat(seq(optional("_"), leaf)));
const layout = ($) => optional($._ws_comment_newline);
const list = ($, item) =>
  seq(
    layout($),
    item,
    repeat(seq(layout($), ",", layout($), item)),
    optional(seq(layout($), ",")),
  );
const header = ($, open, close) =>
  seq(open, optional($._ws), field("key", $.key), optional($._ws), close);
const multiline = ($, delimiter, body) =>
  prec(1, seq(delimiter, optional($.newline), optional(body), delimiter));
const quotes = (quote, mark) =>
  seq(alias(quote, mark), optional(alias(quote, mark)));
const multilineBody = (content, quoteRun) =>
  choice(
    seq(
      repeat1(content),
      repeat(seq(quoteRun, repeat1(content))),
      optional(quoteRun),
    ),
    seq(
      quoteRun,
      repeat(seq(repeat1(content), quoteRun)),
      optional(repeat1(content)),
    ),
  );

export default grammar({
  name: "toml",
  extras: () => [],
  externals: ($) => [
    $._mlb_quote,
    $._mll_quote,
    $._time_hour_start,
    $._date_space,
    $.basic_unescaped,
    $.literal_char,
    $.comment,
    $._continuation_space,
    $._error_sentinel,
    $._date_fullyear_start,
    $._key_dot,
  ],
  conflicts: ($) => [[$.array_values], [$.inline_table_keyvals]],
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
    _ws: () => /[ \t]+/,
    newline: () => /\r?\n/,
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
        repeat1(seq(alias($._key_dot, "."), optional($._ws), $.simple_key)),
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
        seq("u", $._scalar_hex4),
        seq(
          "U",
          choice(
            seq(...times(4, hexdig($, /0/)), $._scalar_hex4),
            seq(
              ...times(3, hexdig($, /0/)),
              hexdig($, /[1-9A-Fa-f]/),
              ...times(4, hexdig($)),
            ),
            seq(
              ...times(2, hexdig($, /0/)),
              hexdig($, /1/),
              hexdig($, /0/),
              ...times(4, hexdig($)),
            ),
          ),
        ),
      ),
    _scalar_hex4: ($) =>
      choice(
        seq(hexdig($, /[0-9A-Ca-cE-Fe-f]/), ...times(3, hexdig($))),
        seq(hexdig($, /[Dd]/), hexdig($, /[0-7]/), ...times(2, hexdig($))),
      ),
    ml_basic_string: ($) => multiline($, '"""', $.ml_basic_body),
    ml_basic_body: ($) => multilineBody($.mlb_content, $.mlb_quotes),
    mlb_content: ($) => choice($.basic_char, $.newline, $.mlb_escaped_nl),
    mlb_quotes: ($) => quotes($._mlb_quote, '"'),
    mlb_escaped_nl: ($) =>
      prec.right(
        seq(
          "\\",
          optional($._ws),
          $.newline,
          repeat(choice($._continuation_space, $.newline)),
        ),
      ),
    literal_string: ($) => seq("'", repeat($.literal_char), "'"),
    ml_literal_string: ($) => multiline($, "'''", $.ml_literal_body),
    ml_literal_body: ($) => multilineBody($.mll_content, $.mll_quotes),
    mll_content: ($) => choice($.literal_char, $.newline),
    mll_quotes: ($) => quotes($._mll_quote, "'"),
    integer: ($) => choice($.dec_int, $.hex_int, $.oct_int, $.bin_int),
    dec_int: ($) => seq(optional(choice("+", "-")), $.unsigned_dec_int),
    unsigned_dec_int: ($) =>
      choice(
        digit($),
        seq(
          alias($._digit1_9, $.digit1_9),
          repeat1(seq(optional("_"), digit($))),
        ),
      ),
    hex_int: ($) => seq("0x", digits(hexdig($))),
    oct_int: ($) => seq("0o", digits(alias($._digit0_7, $.digit0_7))),
    bin_int: ($) => seq("0b", digits(alias($._digit0_1, $.digit0_1))),
    _digit: ($) => choice(/0/, $._digit1_9),
    _digit1_9: () => /[1-9]/,
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
    zero_prefixable_int: ($) => digits(digit($)),
    exp: ($) => seq(choice("e", "E"), $.float_exp_part),
    float_exp_part: ($) =>
      seq(optional(choice("+", "-")), $.zero_prefixable_int),
    special_float: () => seq(optional(choice("-", "+")), choice("inf", "nan")),
    boolean: () => choice("true", "false"),
    date_time: ($) =>
      choice($.offset_date_time, $.local_date_time, $.local_date, $.local_time),
    date_fullyear: ($) => seq($._date_fullyear_start, ...times(4, digit($))),
    date_month: ($) =>
      choice(
        seq(digit($, /0/), digit($, /[1-9]/)),
        seq(digit($, /1/), digit($, /[0-2]/)),
      ),
    date_mday: ($) =>
      choice(
        seq(digit($, /0/), digit($, /[1-9]/)),
        seq(digit($, /[12]/), digit($)),
        seq(digit($, /3/), digit($, /[01]/)),
      ),
    time_delim: ($) => choice("T", "t", alias($._date_space, " ")),
    time_hour: ($) => seq($._time_hour_start, digit($), digit($)),
    time_minute: ($) => seq(digit($, /[0-5]/), digit($)),
    time_second: ($) =>
      choice(
        seq(digit($, /[0-5]/), digit($)),
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
    array_values: ($) => list($, $.val),
    _ws_comment_newline: ($) =>
      repeat1(choice($._ws, $.newline, seq($.comment, $.newline))),
    table: ($) => choice($.std_table, $.array_table),
    std_table: ($) => header($, "[", "]"),
    inline_table: ($) =>
      seq("{", optional($.inline_table_keyvals), layout($), "}"),
    inline_table_keyvals: ($) => list($, $.keyval),
    array_table: ($) => header($, "[[", "]]"),
  },
});
