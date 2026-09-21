(comment) @comment

(unquoted_key) @property

"=" @operator

"," @punctuation.delimiter

[
  "["
  "]"
  "[["
  "]]"
  "{"
  "}"
] @punctuation.bracket

[
  "\"\"\""
  "'''"
] @punctuation.delimiter

[
  "0x"
  "0o"
  "0b"
] @number

[
  "inf"
  "nan"
] @number.float

[
  "true"
  "false"
] @boolean

[
  ":"
  "Z"
  "z"
] @string.special

(dotted_key
  "." @punctuation.delimiter)

(basic_string
  "\"" @punctuation.delimiter)

(literal_string
  "'" @punctuation.delimiter)

(quoted_key
  (basic_string
    (basic_char
      (basic_unescaped) @property)))

(quoted_key
  (literal_string
    (literal_char) @property))

(string
  (basic_string
    (basic_char
      (basic_unescaped) @string)))

(string
  (literal_string
    (literal_char) @string))

(mlb_content
  (basic_char
    (basic_unescaped) @string))

(mll_content
  (literal_char) @string)

(mlb_quotes
  "\"" @string)

(mll_quotes
  "'" @string)

(escaped
  "\\" @string.escape)

(escape_seq_char
  [
    "\""
    "\\"
    "b"
    "e"
    "f"
    "n"
    "r"
    "t"
    "x"
    "u"
    "U"
    (hexdig)
  ] @string.escape)

(mlb_escaped_nl
  "\\" @punctuation.special)

(integer
  (dec_int
    [
      "-"
      "+"
    ] @number))

(integer
  (dec_int
    (unsigned_dec_int
      [
        (digit)
        (digit1_9)
        "_"
      ] @number)))

(hex_int
  [
    (hexdig)
    "_"
  ] @number)

(oct_int
  [
    (digit0_7)
    "_"
  ] @number)

(bin_int
  [
    (digit0_1)
    "_"
  ] @number)

(float_int_part
  (dec_int
    [
      "-"
      "+"
    ] @number.float))

(float_int_part
  (dec_int
    (unsigned_dec_int
      [
        (digit)
        (digit1_9)
        "_"
      ] @number.float)))

(frac
  "." @number.float)

(zero_prefixable_int
  [
    (digit)
    "_"
  ] @number.float)

(exp
  [
    "e"
    "E"
  ] @number.float)

(float_exp_part
  [
    "-"
    "+"
  ] @number.float)

(special_float
  [
    "-"
    "+"
  ] @number.float)

(full_date
  "-" @string.special)

(time_delim
  [
    "T"
    "t"
    " "
  ] @string.special)

(time_secfrac
  [
    "."
    (digit)
  ] @string.special)

(time_numoffset
  [
    "+"
    "-"
  ] @string.special)

(date_fullyear
  (digit) @string.special)

(date_month
  (digit) @string.special)

(date_mday
  (digit) @string.special)

(time_hour
  (digit) @string.special)

(time_minute
  (digit) @string.special)

(time_second
  (digit) @string.special)
