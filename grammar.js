const missing = [
  "date_separator",
  "time_separator",
  "digits",
  "key",
  "assignment_operator",
  "value",
  "basic_string_close",
  "literal_string_close",
  "array_close",
  "inline_table_close",
  "std_table_close",
  "array_table_close",
];
const dateElements = [
  "date_fullyear",
  "date_month",
  "date_mday",
  "time_hour",
  "time_minute",
  "time_second",
];
const twoDigitElements = dateElements.slice(1);
const issueTokens = [
  ["unexpected_value", "invalid_syntax", "unexpected_value", "val"],
  ["unexpected_character", "invalid_syntax", "invalid_character"],
  ["unexpected_header_key", "invalid_syntax", "unexpected_key", "key"],
  ["invalid_header_character", "invalid_syntax", "invalid_character"],
  ["invalid_array_table_close", "invalid_syntax", "invalid_delimiter"],
  ["incomplete_array_table_close", "incomplete_syntax", "incomplete_delimiter"],
  ["missing_dotted_key", "invalid_syntax", "missing_key"],
  [
    "unexpected_time_offset",
    "invalid_syntax",
    "unexpected_time_offset",
    "time_offset",
  ],
  [
    "unexpected_time_fraction",
    "invalid_syntax",
    "unexpected_time_fraction",
    "time_secfrac",
  ],
  ...["dec", "hex", "oct", "bin"].map((base) => [
    `invalid_${base}_digit`,
    "invalid_syntax",
    "invalid_number",
  ]),
  ["leading_zero", "invalid_syntax", "invalid_number", "digit"],
  ["leading_separator", "invalid_syntax", "invalid_number"],
  ...twoDigitElements.flatMap((name) => [
    [`invalid_${name}`, "invalid_syntax", "invalid_date_time", "digits"],
    [
      `incomplete_${name}`,
      "incomplete_syntax",
      "incomplete_date_time",
      "digits",
    ],
  ]),
  ["invalid_number", "invalid_syntax", "invalid_number"],
  ["incomplete_number", "incomplete_syntax", "incomplete_number"],
  ["invalid_value", "invalid_syntax", "invalid_value"],
  ["incomplete_value", "incomplete_syntax", "incomplete_value"],
  [
    "incomplete_numeric_value",
    "incomplete_syntax",
    "incomplete_value",
    "digits",
  ],
  ["invalid_special_float", "invalid_syntax", "invalid_value"],
  ["incomplete_special_float", "incomplete_syntax", "incomplete_value"],
  ["invalid_key_character", "invalid_syntax", "invalid_key_character"],
  ["missing_pair_key", "invalid_syntax", "missing_key"],
  ...missing.flatMap((name) => [
    [`invalid_missing_${name}`, "invalid_syntax", `missing_${name}`],
    [`incomplete_missing_${name}`, "incomplete_syntax", `missing_${name}`],
  ]),
  [
    "missing_ml_basic_string_close",
    "incomplete_syntax",
    "missing_ml_basic_string_close",
  ],
  [
    "missing_ml_literal_string_close",
    "incomplete_syntax",
    "missing_ml_literal_string_close",
  ],
  ["missing_array_separator", "invalid_syntax", "missing_array_separator"],
  [
    "missing_inline_table_separator",
    "invalid_syntax",
    "missing_inline_table_separator",
  ],
  ["missing_newline", "invalid_syntax", "missing_newline"],
  ["invalid_escape", "invalid_syntax", "invalid_escape"],
  ["incomplete_escape", "incomplete_syntax", "incomplete_escape"],
  ["invalid_character", "invalid_syntax", "invalid_character"],
  ["invalid_line_ending", "invalid_syntax", "invalid_line_ending"],
  ["incomplete_line_ending", "incomplete_syntax", "incomplete_line_ending"],
  ["unexpected_separator", "invalid_syntax", "unexpected_separator"],
];
const issueRules = Object.fromEntries(
  issueTokens.flatMap(([token, outcome, reason, content]) => [
    [
      `_${token}_source`,
      ($) => {
        const marker = $[`_${token}`];
        if (token === "unexpected_character")
          return seq($._unexpected_character_start, marker);
        if (content === "digit") return seq(marker, digit($));
        if (content === "digits")
          return seq(marker, repeat1(digit($)), $._date_element_end);
        return content ? seq(marker, $[content]) : marker;
      },
    ],
    [`_${token}_outcome`, ($) => alias($[`_${token}_source`], $[reason])],
    [`_${token}_issue`, ($) => alias($[`_${token}_outcome`], $[outcome])],
  ]),
);
const issue = ($, name) =>
  field("issue", alias($[`_${name}_issue`], $.syntax_issue));
const absent = ($, name) =>
  choice(
    issue($, `invalid_missing_${name}`),
    issue($, `incomplete_missing_${name}`),
  );
const lineIssue = ($) =>
  choice(issue($, "invalid_line_ending"), issue($, "incomplete_line_ending"));
const stringIssue = ($) =>
  choice(
    issue($, "invalid_escape"),
    issue($, "incomplete_escape"),
    issue($, "invalid_character"),
  );

const dateElement = ($, name) =>
  choice(
    seq($[`_${name}_start`], digit($), digit($)),
    issue($, `invalid_${name}`),
    issue($, `incomplete_${name}`),
  );

const sign = optional(choice("-", "+"));

const digit = ($, rule = $._digit) => alias(rule, $.digit);

const hexdig = ($) => alias($._hexdig, $.hexdig);

const times = (count, leaf) => Array(count).fill(leaf);

const underscored = ($, leaf, base) =>
  seq(
    $[`_${base}_continuation`],
    choice(
      leaf,
      issue($, `invalid_${base}_digit`),
      seq("_", leaf),
      issue($, "invalid_number"),
      issue($, "incomplete_number"),
    ),
  );

const separated = ($, leaf, base) =>
  seq(
    choice(
      leaf,
      issue($, "leading_separator"),
      issue($, `invalid_${base}_digit`),
    ),
    repeat(underscored($, leaf, base)),
    optional($._number_end),
  );

const layout = ($) => optional($._ws_comment_newline);

const elements = ($, element, separator) => {
  const values = seq(
    element,
    repeat(
      seq(
        layout($),
        choice(",", issue($, `missing_${separator}`)),
        layout($),
        repeat(seq(issue($, "unexpected_separator"), layout($))),
        element,
      ),
    ),
    optional(
      seq(
        layout($),
        ",",
        repeat(seq(layout($), issue($, "unexpected_separator"))),
      ),
    ),
  );
  return seq(
    layout($),
    choice(
      values,
      seq(
        issue($, "unexpected_separator"),
        repeat(seq(layout($), issue($, "unexpected_separator"))),
        optional(seq(layout($), values)),
      ),
    ),
  );
};

const header = ($, open, close, kind) =>
  seq(
    open,
    optional($._ws),
    choice(field("key", $.key), absent($, "key")),
    repeat(
      seq(
        optional($._ws),
        choice(
          issue($, "unexpected_header_key"),
          issue($, "invalid_header_character"),
        ),
      ),
    ),
    optional($._ws),
    choice(
      close,
      absent($, `${kind}_close`),
      ...(kind === "array_table"
        ? [
            issue($, "invalid_array_table_close"),
            issue($, "incomplete_array_table_close"),
          ]
        : []),
    ),
  );

const multiline = ($, delimiter, body, kind) =>
  prec(
    1,
    seq(
      delimiter,
      optional($.newline),
      optional(body),
      choice(delimiter, issue($, `missing_${kind}_close`)),
    ),
  );

const quotes = (quote, mark) =>
  seq(alias(quote, mark), optional(alias(quote, mark)));

const multilineBody = (content, quotes) =>
  choice(
    seq(
      repeat1(content),
      repeat(seq(quotes, repeat1(content))),
      optional(quotes),
    ),
    seq(
      quotes,
      repeat(seq(repeat1(content), quotes)),
      optional(repeat1(content)),
    ),
  );

export default grammar({
  name: "toml",
  extras: () => [],
  externals: ($) => [
    $._mlb_quote,
    $._mll_quote,
    $._integer_start,
    $._float_start,
    $._date_start,
    $._date_space,
    $._date_end,
    $._time_seconds_start,
    $._time_fraction_start,
    $._time_fraction_digits_start,
    $._time_offset_start,
    $._exponent_start,
    $._float_fraction_start,
    $._positive_exp_sign,
    $._negative_exp_sign,
    $._exponent_digits_start,
    $._dec_continuation,
    $._hex_continuation,
    $._oct_continuation,
    $._bin_continuation,
    $._number_end,
    $._unexpected_character_start,
    $._dot_separator,
    $._expression_end,
    $._blank_line,
    $._broken_comment_start,
    $._comment_end,
    $._date_element_end,
    ...dateElements.map((name) => $[`_${name}_start`]),
    ...issueTokens.map(([name]) => $[`_${name}`]),
    $._error_sentinel,
  ],
  conflicts: ($) => [
    [$.key, $.dotted_key],
    [$.dotted_key],

    [$.array_values],
    [$.inline_table_keyvals],
  ],
  rules: {
    toml: ($) =>
      seq(
        repeat($._line_break),
        optional(
          seq(
            $.expression,
            repeat(
              seq(
                choice(repeat1($._line_break), issue($, "missing_newline")),
                $.expression,
              ),
            ),
            repeat($._line_break),
          ),
        ),
      ),
    _line_break: ($) => choice($.newline, lineIssue($)),
    expression: ($) => seq($._expression, $._expression_end),
    _expression: ($) =>
      choice(
        $._blank_line,
        seq(optional($._ws), $._comment),
        seq(
          optional($._ws),
          choice($.keyval, $.table, issue($, "unexpected_character")),
          repeat(seq(optional($._ws), issue($, "unexpected_character"))),
          optional($._ws),
          optional($._comment),
        ),
      ),
    _ws: () => /[ \t]+/,
    newline: () => /\r?\n/,
    _comment: ($) =>
      choice(
        alias($._normal_comment, $.comment),
        alias($._broken_comment, $.comment),
      ),
    _normal_comment: () => /#[\t\x20-\x7e\u0080-\u{d7ff}\u{e000}-\u{10ffff}]*/u,
    _broken_comment: ($) =>
      seq(
        $._broken_comment_start,
        repeat1(choice($.comment_text, issue($, "invalid_character"))),
        $._comment_end,
      ),
    comment_text: () => /[\t\x20-\x7e\u0080-\u{d7ff}\u{e000}-\u{10ffff}]+/u,
    keyval: ($) =>
      seq(
        choice(field("key", $.key), issue($, "missing_pair_key")),
        optional($._ws),
        choice("=", absent($, "assignment_operator")),
        optional($._ws),
        choice(field("value", $.val), absent($, "value")),
      ),
    key: ($) => choice($.simple_key, $.dotted_key),
    simple_key: ($) =>
      choice(
        $.quoted_key,
        repeat1(choice($.unquoted_key, issue($, "invalid_key_character"))),
      ),
    unquoted_key: () => /[A-Za-z0-9_-]+/,
    quoted_key: ($) => choice($.basic_string, $.literal_string),
    dotted_key: ($) =>
      seq(
        choice($.simple_key, issue($, "missing_dotted_key")),
        repeat1(
          seq(
            optional($._ws),
            alias($._dot_separator, "."),
            optional($._ws),
            choice($.simple_key, absent($, "key")),
          ),
        ),
      ),
    val: ($) =>
      choice(
        seq(
          repeat(issue($, "invalid_character")),
          $._val,
          repeat(issue($, "invalid_character")),
        ),
        repeat1(issue($, "invalid_character")),
      ),
    _val: ($) =>
      choice(
        $.string,
        $.boolean,
        $.array,
        $.inline_table,
        seq($._date_start, $.date_time),
        seq($._float_start, $.float),
        seq($._integer_start, $.integer),
        issue($, "invalid_value"),
        issue($, "incomplete_value"),
        issue($, "incomplete_numeric_value"),
      ),
    string: ($) =>
      choice(
        $.ml_basic_string,
        $.basic_string,
        $.ml_literal_string,
        $.literal_string,
      ),
    basic_string: ($) =>
      seq(
        '"',
        repeat(choice($.basic_char, stringIssue($))),
        choice('"', absent($, "basic_string_close")),
      ),
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
    ml_basic_string: ($) =>
      multiline($, '"""', $.ml_basic_body, "ml_basic_string"),
    ml_basic_body: ($) =>
      multilineBody(
        choice($.mlb_content, stringIssue($), lineIssue($)),
        $.mlb_quotes,
      ),
    mlb_content: ($) => choice($.basic_char, $.newline, $.mlb_escaped_nl),
    mlb_quotes: ($) => quotes($._mlb_quote, '"'),
    mlb_escaped_nl: ($) =>
      prec.right(
        seq("\\", optional($._ws), $.newline, repeat(choice($._ws, $.newline))),
      ),
    literal_string: ($) =>
      seq(
        "'",
        repeat(choice($.literal_char, issue($, "invalid_character"))),
        choice("'", absent($, "literal_string_close")),
      ),
    literal_char: () =>
      /[\t\x20-\x26\x28-\x7e\u0080-\u{d7ff}\u{e000}-\u{10ffff}]/u,
    ml_literal_string: ($) =>
      multiline($, "'''", $.ml_literal_body, "ml_literal_string"),
    ml_literal_body: ($) =>
      multilineBody(
        choice($.mll_content, issue($, "invalid_character"), lineIssue($)),
        $.mll_quotes,
      ),
    mll_content: ($) => choice($.literal_char, $.newline),
    mll_quotes: ($) => quotes($._mll_quote, "'"),
    integer: ($) => choice($.dec_int, $.hex_int, $.oct_int, $.bin_int),
    dec_int: ($) =>
      choice(
        $.unsigned_dec_int,
        seq(
          choice("+", "-"),
          choice(
            $.unsigned_dec_int,
            seq(
              repeat1(
                choice(
                  issue($, "invalid_dec_digit"),
                  issue($, "leading_separator"),
                ),
              ),
              optional($.unsigned_dec_int),
            ),
            absent($, "digits"),
          ),
        ),
      ),
    unsigned_dec_int: ($) =>
      seq(
        choice(
          digit($),
          seq(
            digit($, /0/),
            $._dec_continuation,
            issue($, "invalid_dec_digit"),
            repeat(underscored($, digit($), "dec")),
          ),
          seq(
            issue($, "leading_zero"),
            repeat1(underscored($, digit($), "dec")),
          ),
          seq(
            alias($._digit1_9, $.digit1_9),
            repeat1(underscored($, digit($), "dec")),
          ),
        ),
        optional($._number_end),
      ),
    hex_int: ($) =>
      seq("0x", choice(separated($, hexdig($), "hex"), absent($, "digits"))),
    oct_int: ($) =>
      seq(
        "0o",
        choice(
          separated($, alias($._digit0_7, $.digit0_7), "oct"),
          absent($, "digits"),
        ),
      ),
    bin_int: ($) =>
      seq(
        "0b",
        choice(
          separated($, alias($._digit0_1, $.digit0_1), "bin"),
          absent($, "digits"),
        ),
      ),
    _digit: ($) => choice(/0/, $._digit1_9),
    _digit1_9: () => /[1-9]/,
    _digit0_7: () => /[0-7]/,
    _digit0_1: () => /[01]/,
    _hexdig: ($) => choice($._digit, /[A-Fa-f]/),
    float: ($) =>
      choice(
        seq(
          choice($.float_int_part, absent($, "digits")),
          choice($.exp, seq($.frac, optional($.exp))),
        ),
        $.special_float,
      ),
    float_int_part: ($) => $.dec_int,
    frac: ($) =>
      seq(
        $._float_fraction_start,
        ".",
        choice($.zero_prefixable_int, absent($, "digits")),
      ),
    zero_prefixable_int: ($) => separated($, digit($), "dec"),
    exp: ($) =>
      seq(
        $._exponent_start,
        choice("e", "E"),
        choice($.float_exp_part, absent($, "digits")),
      ),
    float_exp_part: ($) =>
      choice(
        seq($._exponent_digits_start, $.zero_prefixable_int),
        seq(
          choice(
            alias($._positive_exp_sign, "+"),
            alias($._negative_exp_sign, "-"),
          ),
          choice(
            seq($._exponent_digits_start, $.zero_prefixable_int),
            absent($, "digits"),
          ),
        ),
      ),
    special_float: ($) =>
      seq(
        sign,
        choice(
          "inf",
          "nan",
          issue($, "invalid_special_float"),
          issue($, "incomplete_special_float"),
        ),
      ),
    boolean: () => choice("true", "false"),
    date_time: ($) =>
      choice($.offset_date_time, $.local_date_time, $.local_date, $.local_time),
    date_fullyear: ($) => seq($._date_fullyear_start, ...times(4, digit($))),
    date_month: ($) => dateElement($, "date_month"),
    date_mday: ($) => dateElement($, "date_mday"),
    time_delim: ($) => choice("T", "t", seq($._date_space, " ")),
    time_hour: ($) => dateElement($, "time_hour"),
    time_minute: ($) => dateElement($, "time_minute"),
    time_second: ($) => dateElement($, "time_second"),
    time_secfrac: ($) =>
      seq(
        $._time_fraction_start,
        ".",
        choice(
          seq(
            $._time_fraction_digits_start,
            repeat1(digit($)),
            $._date_element_end,
          ),
          absent($, "digits"),
        ),
      ),
    time_numoffset: ($) =>
      seq(
        choice("+", "-"),
        choice($.time_hour, absent($, "digits")),
        choice(":", absent($, "time_separator")),
        choice($.time_minute, absent($, "digits")),
      ),
    time_offset: ($) =>
      seq($._time_offset_start, choice("Z", "z", $.time_numoffset)),
    partial_time: ($) =>
      seq(
        $.time_hour,
        choice(":", absent($, "time_separator")),
        choice($.time_minute, absent($, "digits")),
        optional(
          choice(
            seq(
              $._time_seconds_start,
              ":",
              choice($.time_second, absent($, "digits")),
              optional($.time_secfrac),
            ),
            issue($, "unexpected_time_fraction"),
          ),
        ),
      ),
    full_date: ($) =>
      seq(
        $.date_fullyear,
        "-",
        choice($.date_month, absent($, "digits")),
        choice("-", absent($, "date_separator")),
        choice($.date_mday, absent($, "digits")),
      ),
    full_time: ($) => seq($.partial_time, $.time_offset),
    offset_date_time: ($) => seq($.full_date, $.time_delim, $.full_time),
    local_date_time: ($) =>
      seq(
        $.full_date,
        $.time_delim,
        choice($.partial_time, absent($, "digits")),
      ),
    local_date: ($) => seq($.full_date, $._date_end),
    local_time: ($) =>
      seq($.partial_time, optional(issue($, "unexpected_time_offset"))),
    array: ($) =>
      seq(
        "[",
        optional($.array_values),
        layout($),
        choice("]", absent($, "array_close")),
      ),
    array_values: ($) => elements($, $.val, "array_separator"),
    _ws_comment_newline: ($) =>
      repeat1(
        choice(
          $._ws,
          $.newline,
          lineIssue($),
          seq($._comment, optional($.newline)),
        ),
      ),
    table: ($) => choice($.std_table, $.array_table),
    std_table: ($) => header($, "[", "]", "std_table"),
    inline_table: ($) =>
      seq(
        "{",
        optional($.inline_table_keyvals),
        layout($),
        choice("}", absent($, "inline_table_close")),
      ),
    inline_table_keyvals: ($) =>
      elements(
        $,
        choice($.keyval, issue($, "unexpected_value")),
        "inline_table_separator",
      ),
    array_table: ($) => header($, "[[", "]]", "array_table"),
    ...issueRules,
  },
});
