const bases = ["dec", "hex", "oct", "bin"];
const dateElements = [
  "date_fullyear",
  "date_month",
  "date_mday",
  "time_hour",
  "time_minute",
  "time_second",
];
const missingParts = [
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

const digit = ($, rule = $._digit) => alias(rule, $.digit);

const hexdig = ($) => alias($._hexdig, $.hexdig);

const times = (count, rule) => Array(count).fill(rule);

const followedBy = (name) => ($, marker) => seq(marker, $[name]);

const digitRun = ($, marker) =>
  seq(marker, repeat1(digit($)), $._date_element_end);

const junkRun = ($, start) =>
  prec.right(
    seq(
      start,
      repeat(
        seq($._unexpected_character_continuation, $._unexpected_character),
      ),
    ),
  );

const invalidDigitRun = (base) => ($, marker) =>
  seq(
    marker,
    repeat(
      seq(
        $[`_invalid_${base}_continuation`],
        base === "dec"
          ? choice($._invalid_dec_digit, $._leading_separator)
          : marker,
      ),
    ),
  );

const bothOutcomes = (name, reason, source) => [
  [`invalid_${name}`, "invalid_syntax", reason, source],
  [`incomplete_${name}`, "incomplete_syntax", reason, source],
];

const lexicalIssues = new Set([
  "unexpected_header_key",
  "invalid_header_character",
  "unexpected_separator",
]);

const issues = [
  ["unexpected_value", "invalid_syntax", "unexpected_value", followedBy("val")],
  [
    "unexpected_character",
    "invalid_syntax",
    "invalid_character",
    ($, marker) => junkRun($, seq($._unexpected_character_start, marker)),
  ],
  [
    "unexpected_header_key",
    "invalid_syntax",
    "unexpected_key",
    ($) => prec.dynamic(-1, $.key),
  ],
  ["invalid_header_character", "invalid_syntax", "invalid_character"],
  ...bothOutcomes("array_table_close", "invalid_delimiter"),
  ["missing_dotted_key", "invalid_syntax", "missing_key"],
  [
    "unexpected_time_offset",
    "invalid_syntax",
    "unexpected_time_offset",
    followedBy("time_offset"),
  ],
  [
    "unexpected_time_fraction",
    "invalid_syntax",
    "unexpected_time_fraction",
    followedBy("time_secfrac"),
  ],
  ...bases.map((base) => [
    `invalid_${base}_digit`,
    "invalid_syntax",
    "invalid_number",
    invalidDigitRun(base),
  ]),
  [
    "leading_zero",
    "invalid_syntax",
    "invalid_number",
    ($, marker) => seq(marker, digit($)),
  ],
  [
    "leading_separator",
    "invalid_syntax",
    "invalid_number",
    invalidDigitRun("dec"),
  ],
  ...dateElements
    .slice(1)
    .flatMap((name) => bothOutcomes(name, "invalid_date_time", digitRun)),
  ["incomplete_number", "incomplete_syntax", "invalid_number"],
  ...bothOutcomes("value", "invalid_value"),
  ["incomplete_numeric_value", "incomplete_syntax", "invalid_value", digitRun],
  ...bothOutcomes("special_float", "invalid_value"),
  ["invalid_key_character", "invalid_syntax", "invalid_key_character"],
  ["missing_pair_key", "invalid_syntax", "missing_key"],
  ...missingParts.flatMap((part) =>
    bothOutcomes(`missing_${part}`, `missing_${part}`),
  ),
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
  ...bothOutcomes("escape", "invalid_escape"),
  [
    "invalid_character",
    "invalid_syntax",
    "invalid_character",
    (_, marker) => prec.right(repeat1(marker)),
  ],
  ...bothOutcomes("line_ending", "invalid_line_ending"),
  ["unexpected_separator", "invalid_syntax", "unexpected_separator"],
  ["invalid_encoding", "invalid_syntax", "invalid_encoding"],
  ...bases.map((base) => [
    `invalid_${base}_encoding`,
    "invalid_syntax",
    "invalid_encoding",
  ]),
  [
    "invalid_unicode_escape",
    "invalid_syntax",
    "invalid_escape",
    followedBy("escaped"),
  ],
  [
    "unexpected_encoding",
    "invalid_syntax",
    "invalid_encoding",
    ($, marker) => seq($._unexpected_character_start, marker),
  ],
  ["stray_close", "invalid_syntax", "invalid_character", junkRun],
];

const issueRules = Object.fromEntries(
  issues.flatMap(([name, outcome, reason, source = (_, marker) => marker]) => [
    [`_${name}_source`, ($) => source($, $[`_${name}`])],
    [`_${name}_outcome`, ($) => alias($[`_${name}_source`], $[reason])],
    [`_${name}_issue`, ($) => alias($[`_${name}_outcome`], $[outcome])],
  ]),
);

const issue = ($, name) =>
  field("issue", alias($[`_${name}_issue`], $.syntax_issue));

const anyOutcome = ($, name) =>
  choice(issue($, `invalid_${name}`), issue($, `incomplete_${name}`));

const absent = ($, part) => anyOutcome($, `missing_${part}`);

const invalidText = ($) =>
  choice(issue($, "invalid_character"), issue($, "invalid_encoding"));

const junk = ($) =>
  choice(issue($, "unexpected_character"), issue($, "unexpected_encoding"));

const lineIssue = ($) => anyOutcome($, "line_ending");

const stringIssue = ($) =>
  choice(
    anyOutcome($, "escape"),
    invalidText($),
    issue($, "invalid_unicode_escape"),
  );

const invalidDigit = ($, base) =>
  choice(
    issue($, `invalid_${base}_digit`),
    issue($, `invalid_${base}_encoding`),
  );

const dateElement = ($, name) =>
  choice(seq($[`_${name}_start`], digit($), digit($)), anyOutcome($, name));

const numberPart = ($, leaf, base) =>
  choice(
    leaf,
    invalidDigit($, base),
    seq("_", leaf),
    issue($, "incomplete_number"),
  );

const numberContinuation = ($, leaf, base) =>
  choice(
    seq($[`_${base}_continuation`], numberPart($, leaf, base)),
    prec.right(
      seq(
        $[`_${base}_junk_start`],
        repeat1(
          seq($[`_${base}_junk_continuation`], numberPart($, leaf, base)),
        ),
        optional($._number_junk_end),
      ),
    ),
  );

const numberDigits = ($, leaf, base) => {
  const digits = seq(
    leaf,
    repeat(numberContinuation($, leaf, base)),
    optional($._number_end),
  );
  return choice(
    digits,
    seq(
      repeat1(invalidDigit($, base)),
      optional(seq($._numeric_prefix_digits_start, digits)),
    ),
  );
};

const layout = ($) => optional($._ws_comment_newline);

const list = ($, item, separator, itemEnd = []) => {
  const stray = issue($, "stray_close");
  const extra = seq(layout($), choice(stray, issue($, "unexpected_separator")));
  return choice(
    seq(
      repeat(extra),
      layout($),
      item,
      repeat(
        choice(
          seq(layout($), stray, ...itemEnd),
          seq(
            layout($),
            choice(",", issue($, `missing_${separator}`)),
            repeat(extra),
            layout($),
            item,
          ),
        ),
      ),
      optional(seq(layout($), ",", repeat(extra))),
    ),
    repeat1(extra),
  );
};

const header = ($, open, close, name, ...partialClose) =>
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
    choice(close, absent($, `${name}_close`), ...partialClose),
  );

const multiline = ($, delimiter, body, name) =>
  prec(
    1,
    seq(
      delimiter,
      optional($.newline),
      optional(body),
      choice(delimiter, issue($, `missing_${name}_close`)),
    ),
  );

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
    $._integer_start,
    $._float_start,
    $._date_start,
    $._date_space,
    $._date_end,
    $._time_end,
    $._time_seconds_start,
    $._time_fraction_start,
    $._time_fraction_digits_start,
    $._time_offset_start,
    $._exponent_start,
    $._float_fraction_start,
    $._exponent_digits_start,
    $._fraction_digits_start,
    $._numeric_prefix_digits_start,
    $._signed_exponent_digits_start,
    ...bases.map((base) => $[`_${base}_continuation`]),
    ...bases.map((base) => $[`_${base}_junk_start`]),
    ...bases.map((base) => $[`_${base}_junk_continuation`]),
    $._number_junk_end,
    ...bases.map((base) => $[`_invalid_${base}_continuation`]),
    $._number_end,
    $._unexpected_character_start,
    $._unexpected_character_continuation,
    $._dot_separator,
    $._expression_end,
    $._item_end,
    $._blank_line,
    $._broken_comment_start,
    $.comment_text,
    $._comment_end,
    $._date_element_end,
    ...dateElements.map((name) => $[`_${name}_start`]),
    ...issues
      .filter(([name]) => !lexicalIssues.has(name))
      .map(([name]) => $[`_${name}`]),
    $._escape_prefix,
    $._error_sentinel,
    $._array_open,
    $._array_close,
    $._inline_table_open,
    $._inline_table_close,
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
          choice($.keyval, $.table, junk($)),
          repeat(seq(optional($._ws), junk($))),
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
        repeat1(choice($.comment_text, invalidText($))),
        $._comment_end,
      ),
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
        prec.right(
          repeat1(
            choice(
              $.unquoted_key,
              issue($, "invalid_key_character"),
              issue($, "invalid_encoding"),
            ),
          ),
        ),
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
        seq(repeat(invalidText($)), $._val, repeat(invalidText($))),
        repeat1(invalidText($)),
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
        anyOutcome($, "value"),
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
    escaped: ($) =>
      choice(
        seq("\\", $.escape_seq_char),
        seq(
          $._escape_prefix,
          "\\",
          choice(
            alias($._undecodable_escape, $.escape_seq_char),
            issue($, "invalid_encoding"),
          ),
        ),
      ),
    _undecodable_escape: ($) =>
      seq(
        choice("x", "u", "U"),
        repeat(hexdig($)),
        issue($, "invalid_encoding"),
      ),
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
        repeat(choice($.literal_char, invalidText($))),
        choice("'", absent($, "literal_string_close")),
      ),
    literal_char: () =>
      /[\t\x20-\x26\x28-\x7e\u0080-\u{d7ff}\u{e000}-\u{10ffff}]/u,
    ml_literal_string: ($) =>
      multiline($, "'''", $.ml_literal_body, "ml_literal_string"),
    ml_literal_body: ($) =>
      multilineBody(
        choice($.mll_content, invalidText($), lineIssue($)),
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
                choice(invalidDigit($, "dec"), issue($, "leading_separator")),
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
            invalidDigit($, "dec"),
            repeat(numberContinuation($, digit($), "dec")),
          ),
          seq(
            issue($, "leading_zero"),
            repeat1(numberContinuation($, digit($), "dec")),
          ),
          seq(
            alias($._digit1_9, $.digit1_9),
            repeat1(numberContinuation($, digit($), "dec")),
          ),
        ),
        optional($._number_end),
      ),
    hex_int: ($) =>
      seq("0x", choice(numberDigits($, hexdig($), "hex"), absent($, "digits"))),
    oct_int: ($) =>
      seq(
        "0o",
        choice(
          numberDigits($, alias($._digit0_7, $.digit0_7), "oct"),
          absent($, "digits"),
        ),
      ),
    bin_int: ($) =>
      seq(
        "0b",
        choice(
          numberDigits($, alias($._digit0_1, $.digit0_1), "bin"),
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
        choice(
          seq($._fraction_digits_start, $.zero_prefixable_int),
          absent($, "digits"),
        ),
      ),
    zero_prefixable_int: ($) => numberDigits($, digit($), "dec"),
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
          choice("+", "-"),
          choice(
            seq($._signed_exponent_digits_start, $.zero_prefixable_int),
            absent($, "digits"),
          ),
        ),
      ),
    special_float: ($) =>
      seq(
        optional(choice("-", "+")),
        choice("inf", "nan", anyOutcome($, "special_float")),
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
        choice(seq($.partial_time, optional($._time_end)), absent($, "digits")),
      ),
    local_date: ($) => seq($.full_date, optional($._date_end)),
    local_time: ($) =>
      seq(
        $.partial_time,
        optional(choice(issue($, "unexpected_time_offset"), $._time_end)),
      ),
    array: ($) =>
      seq(
        alias($._array_open, "["),
        optional($.array_values),
        layout($),
        choice(alias($._array_close, "]"), absent($, "array_close")),
      ),
    array_values: ($) => list($, $.val, "array_separator"),
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
        alias($._inline_table_open, "{"),
        optional($.inline_table_keyvals),
        layout($),
        choice(
          alias($._inline_table_close, "}"),
          absent($, "inline_table_close"),
        ),
      ),
    inline_table_keyvals: ($) => {
      const itemEnd = [repeat(junk($)), optional($._item_end)];
      return list(
        $,
        seq(choice($.keyval, issue($, "unexpected_value")), ...itemEnd),
        "inline_table_separator",
        itemEnd,
      );
    },
    array_table: ($) =>
      header($, "[[", "]]", "array_table", anyOutcome($, "array_table_close")),
    _unexpected_separator: () => /,/,
    _invalid_header_character: () => token(/[,{}]+/),
    ...issueRules,
  },
});
