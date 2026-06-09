/**
 * @file Tree-sitter grammar for the Dilang capability-native language.
 *
 * Dilang has no formal grammar yet; the language is iterating. This grammar
 * is pragmatic: it covers the constructs documented in docs/lang/syntax.md
 * accurately enough for syntax highlighting and outline. Where ambiguity
 * costs more than it's worth (turbofish at call sites, map vs row vs block),
 * the grammar is intentionally permissive and lets tree-sitter's error
 * recovery handle the rest.
 */

const PREC = {
  call: 14,
  field: 13,
  unary: 12,
  multiplicative: 11,
  additive: 10,
  comparative: 9,
  logical_and: 8,
  logical_or: 7,
  null_coalesce: 6,
  closure: 5,
  control: 4,
  assign: 3,
};

module.exports = grammar({
  name: 'dilang',

  word: $ => $.identifier,

  extras: $ => [/\s/, $.line_comment, $.block_comment],

  supertypes: $ => [$._item, $._expression, $._type, $._pattern],

  conflicts: $ => [
    [$._type, $._expression],
    [$.struct_literal, $.block],
    [$.row, $.block],
    [$.row, $.map_literal],
    [$.tuple_type, $.parenthesized_expression],
    [$.generic_type, $.binary_expression],
    [$.block, $.expression_statement],
    [$.wiring_spread, $.with_binding],
    [$.wiring_spread, $._expression],
    [$.wiring_spread],
    [$.with_expression],
    [$.call_expression],
    [$.method_call],
  ],

  rules: {
    source_file: $ => repeat($._item),

    line_comment: _ => token(seq('//', /[^\n]*/)),
    block_comment: _ => token(seq(
      '/*',
      /[^*]*\*+([^/*][^*]*\*+)*/,
      '/',
    )),

    // =====================================================================
    // Top-level items
    // =====================================================================

    _item: $ => choice(
      $.function_definition,
      $.capability_definition,
      $.trait_definition,
      $.impl_block,
      $.struct_definition,
      $.enum_definition,
      $.type_alias,
      $.scope_definition,
      $.test_block,
    ),

    // ----- Function -----
    function_definition: $ => seq(
      optional('pub'),
      'fn',
      field('name', $.identifier),
      optional($.type_parameters),
      $.parameter_list,
      optional(seq('->', field('return_type', $._type))),
      repeat(choice($.requires_clause, $.raises_clause, $.where_clause)),
      choice($.block, seq('=', field('body', $._expression), optional(';'))),
    ),

    parameter_list: $ => seq('(', sepBy(',', $.parameter), optional(','), ')'),

    parameter: $ => choice(
      $.self_parameter,
      seq(
        field('name', $.identifier),
        ':',
        field('type', $._type),
        optional(seq('=', field('default', $._expression))),
      ),
    ),

    self_parameter: _ => 'self',

    requires_clause: $ => seq('requires', $.row),
    raises_clause: $ => seq('raises', $.row),
    where_clause: $ => seq('where', sepBy1(',', $.where_bound)),
    where_bound: $ => seq(
      field('param', $.type_identifier),
      ':',
      sepBy1('+', $._type),
    ),

    // ----- Capability / Trait -----
    capability_definition: $ => seq(
      'capability',
      field('name', $.type_identifier),
      optional($.type_parameters),
      optional($.scope_annotation),
      optional($.extends_clause),
      optional($.where_clause),
      $.member_block,
    ),

    trait_definition: $ => seq(
      'trait',
      field('name', $.type_identifier),
      optional($.type_parameters),
      optional($.extends_clause),
      optional($.where_clause),
      $.member_block,
    ),

    scope_annotation: $ => prec.right(seq('@', sepBy1('|', $.lifetime_identifier))),
    extends_clause: $ => seq('extends', sepBy1('+', $._type)),

    member_block: $ => seq(
      '{',
      repeat(choice($.method_signature, $.method_with_default)),
      '}',
    ),

    method_signature: $ => seq(
      'fn',
      field('name', $.identifier),
      optional($.type_parameters),
      $.parameter_list,
      optional(seq('->', field('return_type', $._type))),
      optional($.raises_clause),
    ),

    method_with_default: $ => seq(
      'fn',
      field('name', $.identifier),
      optional($.type_parameters),
      $.parameter_list,
      optional(seq('->', field('return_type', $._type))),
      optional($.raises_clause),
      $.block,
    ),

    // ----- Impl -----
    impl_block: $ => choice(
      // Trait impl: `impl Cap1 + Cap2 for Type { ... }`
      seq(
        'impl',
        optional($.type_parameters),
        field('traits', sepBy1('+', $._type)),
        'for',
        field('for_type', $._type),
        optional($.where_clause),
        $.impl_body,
      ),
      // Inherent impl: `impl Type { ... }`
      seq(
        'impl',
        optional($.type_parameters),
        field('for_type', $._type),
        optional($.where_clause),
        $.impl_body,
      ),
    ),

    impl_body: $ => seq(
      '{',
      optional($.requires_clause),
      repeat(choice($.method_signature, $.method_with_default)),
      '}',
    ),

    // ----- Struct / Enum / Type alias / Scope -----
    struct_definition: $ => seq(
      'struct',
      field('name', $.type_identifier),
      optional($.type_parameters),
      optional($.where_clause),
      $.struct_fields,
    ),

    struct_fields: $ => seq(
      '{',
      sepBy(',', $.struct_field),
      optional(','),
      '}',
    ),

    struct_field: $ => seq(
      field('name', $.identifier),
      ':',
      field('type', $._type),
    ),

    enum_definition: $ => seq(
      optional('open'),
      'enum',
      field('name', $.type_identifier),
      optional($.type_parameters),
      '{',
      repeat($.enum_variant),
      '}',
    ),

    enum_variant: $ => seq(
      field('name', $.type_identifier),
      optional($.variant_payload),
      optional(choice(',', ';')),
    ),

    variant_payload: $ => seq(
      '(',
      sepBy(',', choice($.struct_field, $._type)),
      optional(','),
      ')',
    ),

    type_alias: $ => seq(
      'type',
      field('name', $.type_identifier),
      optional($.type_parameters),
      '=',
      field('value', $._type),
    ),

    scope_definition: $ => seq(
      'scope',
      field('name', $.lifetime_identifier),
      optional(seq('under', field('parent', $.lifetime_identifier))),
    ),

    test_block: $ => seq('test', field('name', $.string_literal), $.block),

    // =====================================================================
    // Types
    // =====================================================================

    _type: $ => choice(
      $.primitive_type,
      $.type_identifier,
      $.self_type,
      $.generic_type,
      $.optional_type,
      $.array_type,
      $.function_type,
      $.tuple_type,
      $.row,
    ),

    // Lowercase built-in scalar types (DEC-024). `Str` and other library types
    // stay capitalized and parse as `type_identifier`. These names also match the
    // `identifier` pattern; the `word` directive's keyword extraction promotes
    // them to `primitive_type` only in type position.
    primitive_type: _ => choice(
      'i8', 'i16', 'i32', 'i64', 'isize',
      'u8', 'u16', 'u32', 'u64', 'usize',
      'f32', 'f64', 'bool', 'char',
    ),

    self_type: _ => 'Self',

    generic_type: $ => prec(1, seq(
      $.type_identifier,
      $.type_arguments,
    )),

    type_arguments: $ => seq('<', sepBy1(',', $._type), '>'),

    optional_type: $ => prec(2, seq($._type, '?')),

    array_type: $ => seq('[', $._type, ']'),

    function_type: $ => prec.right(seq(
      'fn',
      '(',
      sepBy(',', $._type),
      ')',
      optional(seq('->', $._type)),
      optional($.requires_clause),
      optional($.raises_clause),
    )),

    tuple_type: $ => seq('(', sepBy1(',', $._type), ')'),

    row: $ => seq(
      '{',
      sepBy(choice(',', '+'), $._type),
      '}',
    ),

    type_parameters: $ => seq('<', sepBy1(',', $.type_parameter), '>'),

    type_parameter: $ => seq(
      $.type_identifier,
      optional(seq(':', sepBy1('+', $._type))),
    ),

    // =====================================================================
    // Blocks and statements
    // =====================================================================

    block: $ => seq(
      '{',
      repeat($._statement),
      optional($._expression),
      '}',
    ),

    _statement: $ => choice(
      $.let_binding,
      $.defer_statement,
      $.assign_statement,
      $.expression_statement,
    ),

    expression_statement: $ => seq($._expression, optional(';')),

    let_binding: $ => seq(
      'let',
      optional('mut'),
      field('name', $.identifier),
      optional(seq(':', field('type', $._type))),
      '=',
      field('value', $._expression),
      optional(';'),
    ),

    defer_statement: $ => seq(
      'defer',
      $._expression,
      optional(';'),
    ),

    assign_statement: $ => prec.right(PREC.assign, seq(
      field('lhs', $._expression),
      '=',
      field('rhs', $._expression),
      optional(';'),
    )),

    // =====================================================================
    // Expressions
    // =====================================================================

    _expression: $ => choice(
      $.string_literal,
      $.tagged_string_literal,
      $.char_literal,
      $.number_literal,
      $.boolean_literal,
      $.identifier,
      $.type_identifier,
      $.self_expression,
      $.list_literal,
      $.map_literal,
      $.struct_literal,
      $.call_expression,
      $.method_call,
      $.field_access,
      $.optional_chain,
      $.index_expression,
      $.binary_expression,
      $.unary_expression,
      $.null_coalesce_expression,
      $.closure,
      $.if_expression,
      $.match_expression,
      $.try_expression,
      $.raise_expression,
      $.return_expression,
      $.break_expression,
      $.continue_expression,
      $.loop_expression,
      $.for_expression,
      $.while_expression,
      $.with_expression,
      $.stream_expression,
      $.select_expression,
      $.uncancellable_expression,
      $.block,
      $.parenthesized_expression,
    ),

    self_expression: _ => 'self',

    parenthesized_expression: $ => seq('(', $._expression, ')'),

    boolean_literal: _ => choice('true', 'false'),

    // Integer/float literals with optional type suffix (DEC-024): `1u64`,
    // `42i8`, `1.0f32`, `3f32`. A float is digits-with-a-point or digits-with-a-
    // float-suffix; an integer is digits with an optional integer suffix.
    number_literal: _ => token(
      /-?[0-9][0-9_]*(\.[0-9_]+)?(i8|i16|i32|i64|isize|u8|u16|u32|u64|usize|f32|f64)?/
    ),

    char_literal: _ => token(seq(
      "'",
      choice(/[^'\\]/, seq('\\', /./)),
      "'",
    )),

    // String with `${...}` interpolation.
    string_literal: $ => seq(
      '"',
      repeat(choice(
        $._string_chars,
        $.escape_sequence,
        $.string_interpolation,
      )),
      '"',
    ),
    _string_chars: _ => token.immediate(prec(1, /([^"\\$]|\$[^{])+/)),
    escape_sequence: _ => token.immediate(seq('\\', /./)),
    string_interpolation: $ => seq('${', $._expression, '}'),

    // Tagged string: `sql"..."`, `r"..."`, etc.
    tagged_string_literal: $ => seq(
      field('tag', $.identifier),
      token.immediate('"'),
      repeat(choice(
        $._string_chars,
        $.escape_sequence,
        $.string_interpolation,
      )),
      '"',
    ),

    list_literal: $ => seq(
      '[',
      sepBy(',', $._expression),
      optional(','),
      ']',
    ),

    map_literal: $ => seq(
      '{',
      sepBy1(',', $.map_entry),
      optional(','),
      '}',
    ),
    map_entry: $ => seq(
      field('key', $._expression),
      ':',
      field('value', $._expression),
    ),

    struct_literal: $ => prec(2, seq(
      field('type', $.type_identifier),
      '{',
      sepBy(',', choice($.struct_field_init, $.struct_spread)),
      optional(','),
      '}',
    )),
    struct_field_init: $ => seq(
      field('name', $.identifier),
      optional(seq(':', field('value', $._expression))),
    ),
    struct_spread: $ => seq('...', $._expression),

    // A call can take a trailing block as its last argument:
    // `with_timeout(2.seconds) { body }`, `IO.with_cancel(|tok| { ... })`.
    call_expression: $ => prec(PREC.call, seq(
      field('function', $._expression),
      field('arguments', $.argument_list),
      optional(field('trailing_block', $.block)),
    )),

    method_call: $ => prec(PREC.call, seq(
      field('receiver', $._expression),
      '.',
      field('method', $.identifier),
      field('arguments', $.argument_list),
      optional(field('trailing_block', $.block)),
    )),

    argument_list: $ => seq(
      '(',
      sepBy(',', choice($.named_argument, $._expression)),
      optional(','),
      ')',
    ),

    // Named call argument: `FiberRuntime(workers: 8)`, `Logger.info("...", {})`.
    // Higher precedence than ordinary expression so the parser prefers the
    // named-argument shape when it sees `ident :`.
    named_argument: $ => prec(2, seq(
      field('name', $.identifier),
      ':',
      field('value', $._expression),
    )),

    field_access: $ => prec(PREC.field, seq(
      field('object', $._expression),
      '.',
      field('field', choice($.identifier, $.type_identifier)),
    )),

    optional_chain: $ => choice(
      prec(PREC.call, seq(
        $._expression,
        '?.',
        $.identifier,
        $.argument_list,
      )),
      prec(PREC.field, seq(
        $._expression,
        '?.',
        $.identifier,
      )),
    ),

    index_expression: $ => prec(PREC.call, seq(
      $._expression,
      '[',
      $._expression,
      ']',
    )),

    unary_expression: $ => prec(PREC.unary, seq(
      choice('-', '!'),
      $._expression,
    )),

    binary_expression: $ => {
      const operators = [
        ['+', PREC.additive],
        ['-', PREC.additive],
        ['*', PREC.multiplicative],
        ['/', PREC.multiplicative],
        ['%', PREC.multiplicative],
        ['==', PREC.comparative],
        ['!=', PREC.comparative],
        ['<', PREC.comparative],
        ['<=', PREC.comparative],
        ['>', PREC.comparative],
        ['>=', PREC.comparative],
        ['&&', PREC.logical_and],
        ['||', PREC.logical_or],
      ];
      return choice(...operators.map(([op, p]) =>
        prec.left(p, seq(
          field('left', $._expression),
          field('operator', op),
          field('right', $._expression),
        )),
      ));
    },

    null_coalesce_expression: $ => prec.right(PREC.null_coalesce, seq(
      field('value', $._expression),
      '??',
      field('default', $._expression),
    )),

    closure: $ => choice(
      // No-parameter shorthand: `|| expr`. The `||` is a single token here.
      prec(PREC.closure, seq('||', field('body', $._expression))),
      prec(PREC.closure, seq(
        '|',
        sepBy1(',', $.closure_parameter),
        '|',
        field('body', $._expression),
      )),
    ),
    closure_parameter: $ => seq(
      field('name', $.identifier),
      optional(seq(':', field('type', $._type))),
    ),

    if_expression: $ => prec.right(PREC.control, seq(
      'if',
      field('condition', $._expression),
      field('then', $.block),
      optional(seq('else', field('else', choice($.if_expression, $.block)))),
    )),

    match_expression: $ => seq(
      'match',
      field('scrutinee', $._expression),
      '{',
      repeat($.match_arm),
      '}',
    ),

    match_arm: $ => seq(
      field('pattern', $._pattern),
      '=>',
      field('body', $._expression),
      optional(','),
    ),

    _pattern: $ => choice(
      $.identifier,
      $.type_identifier,
      $.variant_pattern,
      $.literal_pattern,
      $.wildcard_pattern,
    ),

    wildcard_pattern: _ => '_',
    literal_pattern: $ => choice($.string_literal, $.number_literal, $.boolean_literal),
    variant_pattern: $ => prec(1, seq(
      field('name', $.type_identifier),
      optional(seq('.', choice($.type_identifier, $.wildcard_pattern))),
      optional(seq('(', sepBy(',', $._pattern), ')')),
    )),

    try_expression: $ => prec.right(PREC.control, seq(
      'try',
      field('body', $._expression),
      optional($.catch_clause),
    )),

    catch_clause: $ => seq(
      'catch',
      choice(
        seq($._pattern, '=>', $._expression),
        seq('{', repeat($.match_arm), '}'),
      ),
    ),

    raise_expression:    $ => prec.right(PREC.control, seq('raise', optional($._expression))),
    return_expression:   $ => prec.right(PREC.control, seq('return',   optional($._expression))),
    break_expression:    $ => prec.right(PREC.control, seq('break',    optional($._expression))),
    continue_expression: _ => 'continue',

    loop_expression: $ => seq('loop', $.block),
    for_expression: $ => seq(
      'for',
      field('pattern', $._pattern),
      'in',
      field('iter', $._expression),
      field('body', $.block),
    ),
    while_expression: $ => seq(
      'while',
      field('condition', $._expression),
      field('body', $.block),
    ),

    // `with [ ... ]` is a Wiring value; `with [ ... ] @ 'Scope { ... }`
    // enters a scoped capability frame and evaluates the body.
    with_expression: $ => choice(
      prec.right(1, seq(
        'with',
        $.with_entries,
        optional($.scope_annotation),
        field('body', $.block),
      )),
      prec(-1, seq(
        'with',
        $.with_entries,
        optional($.scope_annotation),
      )),
    ),

    // Entries in a with block can be separated by comma or just newline.
    // Trailing comma allowed.
    with_entries: $ => seq(
      '[',
      repeat(seq(
        choice($.with_binding, $.wiring_spread),
        optional(','),
      )),
      ']',
    ),

    with_binding: $ => seq(
      field('cap', $.type_identifier),
      '<-',
      field('impl', $._expression),
      optional(seq('@', field('scope', $.lifetime_identifier))),
    ),

    wiring_spread: $ => seq('...', $._expression),

    stream_expression: $ => seq('stream', $.block),

    // `select` arms gate on a suspending expression (like `fa.await()`),
    // not a pattern; the LHS is a value, not something to destructure.
    select_expression: $ => seq('select', '{', repeat($.select_arm), '}'),
    select_arm: $ => seq(
      field('event', $._expression),
      '=>',
      field('body', $._expression),
      optional(','),
    ),

    uncancellable_expression: $ => seq('uncancellable', $.block),

    // =====================================================================
    // Identifiers
    // =====================================================================
    // Lowercase- or underscore-leading → value / function identifier.
    // PascalCase → type / capability / scope identifier.
    identifier: _ => /[a-z_][a-zA-Z0-9_]*/,
    type_identifier: _ => /[A-Z][a-zA-Z0-9_]*/,
    lifetime_identifier: _ => /'[A-Z][a-zA-Z0-9_]*/,
  },
});

function sepBy(sep, rule) {
  return optional(sepBy1(sep, rule));
}
function sepBy1(sep, rule) {
  return seq(rule, repeat(seq(sep, rule)));
}
