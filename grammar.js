/**
 * @file Tree sitter grammar for the Cisco IOS network Operating System
 * @author David Gethings <dgethings76@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check
function sep1(rule, separator) {
  return seq(rule, repeat(seq(separator, rule)));
}

function statement_start() {
  return alias(/\{\%[\+\-]?/, "statement_start");
}

function statement_end() {
  return alias(/[\+\-]?\%\}/, "statement_end");
}

/**
 * Matches something like `{% <kw> ...rest %}`
 */
function statement(kw, ...rest) {
  return seq(statement_start(), keyword(kw), ...rest, statement_end());
}

function expression_in_statement($) {
  return alias($._expression_in_statement, $.expression);
}

function keyword(kw) {
  return alias(token(prec(1, kw)), "_keyword");
}

function context_specifier() {
  return choice(keyword("with context"), keyword("without context"));
}

export default grammar({
  name: "cisco_ios_jinja2",
  word: $ => $.identifier,
  // `\n` is deliberately NOT in `extras` (only spaces/tabs/CR). Keeping
  // newlines significant is what makes `command_line` line-bound: its arg
  // tokens (`value`, `output`) all exclude `\n`, so once the lexer hits a
  // newline the repeat(arg) cannot continue onto the next line. Every
  // multi-line repeat (`config`, section bodies, jinja statement bodies)
  // explicitly consumes inter-item newlines via the hidden `_nl` rule.
  extras: $ => [/[\t\r ]/],
  conflicts: $ => [[$.elif_statement], [$.router_header], [$._cmd_arg, $.ip_access_list_header]],
  // `section`/`section_header` are dispatch helpers over concrete section types;
  // inline them so the emitted node is the concrete section/header (e.g.
  // `interface_section`, `router_header`) rather than a redundant wrapper.
  inline: $ => [$.section, $.section_header],

  rules: {
    config: $ => repeat($._top_item),

    // Hidden newline token. Because `\n` is not in `extras`, inter-item
    // newlines must be consumed explicitly; this rule (hidden, so it does not
    // appear in the AST) is mixed into `_top_item` / `_body_item` / `_item` so
    // every multi-line repeat can absorb blank/separator lines uniformly.
    _nl: $ => /\n+/,

    // Top-level dispatch. This is the old `_item` (j2 + ios + output + comment +
    // text) with the new `section` added on top. `_j2_statement` is kept here so
    // top-level jinja statements (e.g. a bare `{% for %}...{% endfor %}`) keep
    // parsing exactly as before.
    _top_item: $ => choice(
      $._nl,
      $.section,
      $._j2_statement,
      $._ios_statement,
      $.output,
      $.comment,
      $.text,
    ),

    // Kept for the jinja statement bodies below; unchanged so their emitted AST
    // stays byte-identical. Includes `section` so a jinja body (e.g. a
    // `{% for %}` loop) can contain an `interface_section` / `router_section`.
    // `_nl` consumes inter-item newlines (since `\n` is no longer an extra).
    _item: $ => choice($._nl, $.section, $._j2_statement, $._ios_statement, $.output, $.comment, $.text),

    // Hierarchical section model. A section is a header followed by a body of
    // commands, terminated by an explicit `!` (eos). Each `*_header` carries a
    // named `name` field (where applicable) so downstream tooling (LSP symbol
    // table, definition/references) can resolve the section as a definition
    // site.
    section: $ => choice(
      $.interface_section,
      $.router_section,
      $.route_map_section,
      $.class_map_section,
      $.policy_map_section,
      $.vlan_section,
      $.line_section,
      $.redundancy_section,
      $.ip_access_list_section,
    ),

    interface_section: $ => seq(
      $.interface_header,
      repeat(choice($._nl, $._body_item)),
      $.eos,
    ),

    _body_item: $ => choice(
      $.section,
      $.negated_statement,
      $._command,
      $.output,
      $.comment,
      $.text,
      // NOTE: `eos` is deliberately excluded so a section consumes its own
      // terminating `!` rather than the body eating it.
    ),

    // Bare command set — NO field wrappers and NO negated_statement, so the
    // generic `negated_statement` can wrap any of these without recursion.
    // `command_line` is the generic fallback that structures every word-leading
    // line; specific commands above it win via their `token(prec(2, ...))`
    // keywords (hostname/version/service tokenize as the keyword, not as
    // `identifier`).
    _command: $ => choice(
      $.hostname_statement,
      $.version_statement,
      $.service_statement,
      $.description_statement,
      $.shutdown_statement,
      $.speed_statement,
      $.duplex_statement,
      $.mtu_statement,
      $.address_family_statement,
      $.neighbor_statement,
      $.network_statement,
      $.redistribute_statement,
      $.passive_interface_statement,
      $.router_id_statement,
      $.exit_address_family_statement,
      $.metric_style_statement,
      $.graceful_restart_statement,
      $.queue_depth_statement,
      $.compatible_statement,
      $.auto_cost_statement,
      $.aggregate_address_statement,
      $.af_interface_statement,
      $.autonomous_system_statement,
      $.maximum_prefix_statement,
      $.summary_prefix_statement,
      $.default_information_statement,
      $.distribute_list_statement,
      $.snmp_server_statement,
      $.scheduler_statement,
      $.hw_module_statement,
      $.memory_statement,
      $.rtr_statement,
      $.exception_statement,
      $.subscriber_statement,
      $.mac_address_table_statement,
      $.kerberos_statement,
      $.boot_statement,
      $.tacacs_server_statement,
      $.parser_statement,
      // --- config-line rich rules (see comment block above `negated_statement`)
      $.exec_timeout_statement,
      $.login_statement,
      $.password_statement,
      $.transport_statement,
      $.access_class_statement,
      $.terminal_type_statement,
      $.length_statement,
      $.width_statement,
      $.editing_statement,
      $.motd_banner_statement,
      $.escape_character_statement,
      $.activation_character_statement,
      $.databits_statement,
      $.parity_statement,
      $.padding_statement,
      $.stopbits_statement,
      // --- access-list rich rules (ACE permit/deny; see comment block above
      // `permit_statement` — these are the line-starting first token of every
      // config-(ext|std|ipv6|ext-macl)-nacl / config-source-guard ACE line)
      $.permit_statement,
      $.deny_statement,
      // --- numbered access-list flat statement (see comment block above
      // `access_list_statement` — this is the leading keyword of every
      // numbered config ACL line `access-list <N> permit|deny ...`)
      $.access_list_statement,
      // --- rich misc rules (match/set/class + vlan/pmap-c/redundancy/route-map;
      // see comment block above `match_statement` for the GENERIC rationale and
      // the per-keyword deferred notes)
      $.match_statement,
      $.set_statement,
      $.class_statement,
      $.remote_span_statement,
      $.private_vlan_statement,
      $.police_statement,
      $.priority_statement,
      $.drop_statement,
      $.random_detect_statement,
      $.auto_sync_statement,
      $.continue_statement,
      $.command_line,
    ),

    // Generic command line: a leading identifier (the first keyword token) plus
    // zero or more args. Multi-word command identity is resolved downstream by
    // the LSP against data/commands.json — NOT by the AST — so only the first
    // token is captured as `name`. `_cmd_arg` deliberately excludes
    // `interface_name` (which overlaps `value` and creates lexical ambiguity).
    //
    // `prec.right` makes the rule right-associative, so a shift/reduce conflict
    // where the next token could either extend this command_line (e.g. an arg
    // that is itself an `output`/`{{...}}`) or begin a sibling item resolves by
    // shifting — i.e. the longer match wins and the token stays inside args.
    //
    // Line-bound: because `\n` is NOT in `extras` (see top of file), the
    // `repeat(arg)` cannot drift across a newline — `value`/`output`/`identifier`
    // all exclude `\n`, so the repeat stops at end-of-line and the following
    // `_nl` (consumed by the enclosing `config`/section body repeat) cleanly
    // separates this command_line from the next item.
    command_line: $ => prec.right(seq(
      field("name", $.identifier),
      repeat(field("arg", $._cmd_arg)),
    )),
    // `_cmd_arg` includes the section-header keywords (aliased back to
    // `value`) because tree-sitter's lexer will commit to the prec-2 keyword
    // tokenization whenever the keyword text appears mid-line in a position
    // where it COULD begin a sibling section (e.g. inside an interface body or
    // at top level between two sections). Without these aliases, a line like
    //   ip policy route-map BAR
    // would be split into `command_line(ip) + arg(policy)` followed by a
    // spurious `route_map_section` because the lexer produced the `route-map`
    // keyword token and `command_line`'s arg position couldn't accept it.
    // By accepting the keyword here (aliased to `value` so the AST stays
    // uniform), command_line can consume the keyword as a regular arg.
    _cmd_arg: $ => choice(
      $.value,
      $.output,
      alias($.route_map_kw, $.value),
      alias($.class_map_kw, $.value),
      alias($.policy_map_kw, $.value),
      alias($.vlan_kw, $.value),
      alias($.line_kw, $.value),
      alias($.redundancy_kw, $.value),
      alias($.access_list_kw, $.value),
    ),

    section_header: $ => choice(
      $.interface_header,
      $.router_header,
      $.route_map_header,
      $.class_map_header,
      $.policy_map_header,
      $.vlan_header,
      $.line_header,
      $.redundancy_header,
      $.ip_access_list_header,
    ),

    interface_header: $ => seq(
      token(prec(2, "interface")),
      field("name", choice(
        // The `seq(interface_name, output)` alternative (e.g.
        // `interface Loopback{{ n }}`) is preferred over bare
        // `interface_name` via prec(1) — without it the GLR conflict
        // (`[$.interface_header]`) can resolve to the shorter match once the
        // body has `_nl`/other items to absorb the orphaned `output`.
        prec(1, seq($.interface_name, $.output)),
        $.interface_name,
        $.output,
      )),
    ),

    interface_name: $ => /[A-Za-z0-9_\/.\-]+/,

    // text excludes `!`, `{`, and `\n` so each token stays within a single
    // line — without the `\n` exclusion this catch-all would greedily swallow
    // every following line until the next `!`, eating real commands.
    //
    // The main token's first character must NOT be a word char (`\w`) AND must
    // NOT be whitespace (`\s`). Excluding `\w` routes word-leading lines to
    // `command_line`; excluding `\s` prevents text from greedily swallowing the
    // arg portion of a command line once the leading identifier has been
    // consumed (e.g. the leading space of ` address ...` after `ip`). With both
    // excluded, text only catches runs that begin with non-word punctuation
    // (stray symbols like `*`, `>`, `-`). The lone `{` branch stays for raw
    // Jinja. NB: this is a small deviation from the plan's literal regex
    // (`[^!\{\n\w]...`) — the whitespace exclusion is required because extras
    // skip the leading indent of body items, which would otherwise let text
    // out-compete `value` args on longest-match.
    text: $ =>
      prec.right(
        repeat1(choice(
          token(prec(-1, /\{/)),
          token(prec(1, /[^!\{\n\w\s][^!\{\n]*/)),
        )),
      ),

    eos: _ => token(prec(2, "!")),
    // ios_comment is line-bounded (`[^\n]`) so it cannot run across newlines.
    // Requires at least `! +<something>` (so a bare `!` still goes to `eos`);
    // given a real comment body, the longer match wins over `eos`.
    ios_comment: _ => token(prec(2, /! +[^\n]+/)),
    j2_comment: _ => seq("{#", repeat(/[^\#]+|[\#]/), "#}"),
    comment: $ => choice($.ios_comment, $.j2_comment),

    output: $ =>
      seq("{{", optional($._output_code), "}}"),
    _output_code: _ => prec.right(repeat1(/[^\s\}\-\+]+|[\}\-\+]/)),

    _expression_in_statement: _ => repeat1(/[^\s\%\-\+]+|[\%\-\+]/),

    // Top-level dispatch for IOS statements. This mirrors the rich-rule
    // portion of `_command` (used inside section bodies and inside
    // `negated_statement`) so the config-global rich rules fire for TOP-LEVEL
    // global config lines too (e.g. a bare `snmp-server community ...` outside
    // any section). The list is duplicated against `_command` rather than
    // expressed as `_command` + extras because `service_statement` carries a
    // `field("keyword", ...)` wrapper here that the corpus expects at the
    // `config` level, which would otherwise create a reduce/reduce conflict
    // (service reachable via both paths with different field annotations).
    //
    // The config-line rich rules are listed here too because the grammar has
    // NO `line_section` — only `interface_section` and `router_section` exist —
    // so a `line <subcmd>` line parses at TOP LEVEL (just like a global
    // command). Without this registration, `transport input ...` or
    // `exec-timeout 5 0` at top level would silently fall back to
    // `command_line` instead of using the rich rule. The list mirrors the
    // config-line entries in `_command` exactly (each rule named directly,
    // NOT via `_command`) so negation (`no <line-cmd>`) and top-level
    // placement both work without a reduce/reduce conflict.
    // `command_line` stays last as the generic fallback.
    _ios_statement: $ =>
      choice(
        $.hostname_statement,
        $.version_statement,
        $.eos,
        $.negated_statement,
        field("keyword", $.service_statement),
        $.snmp_server_statement,
        $.scheduler_statement,
        $.hw_module_statement,
        $.memory_statement,
        $.rtr_statement,
        $.exception_statement,
        $.subscriber_statement,
        $.mac_address_table_statement,
        $.kerberos_statement,
        $.boot_statement,
        $.tacacs_server_statement,
        $.parser_statement,
        // --- config-line rich rules (mirror the entries in `_command`)
        $.exec_timeout_statement,
        $.login_statement,
        $.password_statement,
        $.transport_statement,
        $.access_class_statement,
        $.terminal_type_statement,
        $.length_statement,
        $.width_statement,
        $.editing_statement,
        $.motd_banner_statement,
        $.escape_character_statement,
        $.activation_character_statement,
        $.databits_statement,
        $.parity_statement,
        $.padding_statement,
        $.stopbits_statement,
        // --- access-list rich rules (mirror the entries in `_command`).
        // The grammar has NO `access_list_section` (only `interface_section`
        // and `router_section`), so a `permit ...` / `deny ...` ACE line
        // parses at TOP LEVEL just like a global command. Without this
        // registration, an ACE line at top level would silently fall back to
        // `command_line` (which needs `identifier`, not the prec-2 keyword).
        $.permit_statement,
        $.deny_statement,
        // --- numbered access-list flat statement (mirrors the entry in
        // `_command`). Without this registration, a `access-list <N> ...`
        // line at top level would silently fall back to `command_line`
        // (which needs `identifier`, not the prec-2 `access_list_kw`).
        $.access_list_statement,
        // --- rich misc rules (mirror the entries in `_command`). The grammar
        // has NO vlan/class-map/policy-map/redundancy/route-map sections (only
        // `interface_section` and `router_section`), so every `match ...`,
        // `set ...`, `class ...`, `remote-span`, `private-vlan ...`,
        // `police ...`, `priority`, `drop`, `random-detect ...`,
        // `auto-sync ...`, `continue ...` line parses at TOP LEVEL just like a
        // global command. Without this registration, these lines at top level
        // would silently fall back to `command_line` (which needs `identifier`,
        // not the prec-2 keyword).
        $.match_statement,
        $.set_statement,
        $.class_statement,
        $.remote_span_statement,
        $.private_vlan_statement,
        $.police_statement,
        $.priority_statement,
        $.drop_statement,
        $.random_detect_statement,
        $.auto_sync_statement,
        $.continue_statement,
        $.command_line,
      ),

    _j2_statement: $ =>
      choice(
        $.for_statement,
        $.if_statement,
        $.macro_statement,
        $.call_statement,
        $.filter_statement,
        $.assignment_statement,
        $.end_assignment_statement,
        $.extends_statement,
        $.block_statement,
        $.include_statement,
        $.import_statement,
        $.with_statement,
        $.raw_statement,
        $.custom_statement,
      ),

    hostname_statement: $ => seq(
      token(prec(2, "hostname")),
      field("hostname_value", choice($.output, $.value)),
    ),

    version_statement: $ => seq(
      token(prec(2, "version")),
      field("configured_version", choice($.value, $.output)),
    ),

    // --- config-if "rich" sub-commands -------------------------------------
    // These OVERRIDE the generic `command_line` for high-frequency interface
    // sub-commands. Each leading keyword is `token(prec(2, ...))` so it
    // tokenizes as a keyword rather than as the generic `identifier`/`value`
    // that `command_line` starts with — that is what lets the rich rule win.
    //
    // NOTE on `ip address`: DEFERRED. Promoting `ip` (or even `address`) to a
    // prec-2 keyword breaks every OTHER `ip ...` config-if/global command
    // (ip access-group, ip helper-address, ip route, ip verify, ...) because
    // the lexer commits to the keyword tokenization and tree-sitter's GLR
    // does NOT re-lex. At top level `ip route` survived (rich rule not in
    // scope there), but inside section bodies / `negated_statement` the rich
    // rule IS in scope, so `ip` lexed as a keyword and the `command_line`
    // fallback (which needs `identifier`) died → ERROR. This single rule
    // regressed coverage by +344 errors (config-if 64→351, config 19→64).
    // Re-enable only with a technique that keeps `ip` lexable as `identifier`
    // (e.g. an external scanner or a lookahead-gated rule).

    description_statement: $ => prec.right(seq(
      token(prec(2, "description")),
      // `repeat` (not `repeat1`): a bare `description`/`no description` is a
      // valid IOS form (the latter removes the description), and the prec-2
      // keyword means `command_line` can no longer backstop the zero-arg case.
      field("text", repeat($._cmd_arg)),
    )),

    shutdown_statement: $ => seq(token(prec(2, "shutdown"))),

    speed_statement: $ => seq(
      token(prec(2, "speed")),
      field("value", choice($.value, $.output)),
    ),

    duplex_statement: $ => seq(
      token(prec(2, "duplex")),
      field("value", choice($.value, $.output)),
    ),

    mtu_statement: $ => seq(
      token(prec(2, "mtu")),
      field("size", choice($.value, $.output)),
    ),

    router_section: $ => seq(
      $.router_header,
      repeat(choice($._nl, $._body_item)),
      $.eos,
    ),

    router_header: $ => seq(
      token(prec(2, "router")),
      field("protocol", $.routing_protocol),
      field("process_id", choice($.value, $.output, seq($.value, $.output))),
    ),

    routing_protocol: $ => choice(
      token(prec(2, "bgp")),
      token(prec(2, "ospf")),
    ),

    // --- additional hierarchical sections ---------------------------------
    // These were previously DEFERRED (see the historic comment block at the
    // rich misc rules / `match_statement`). Each header promotes its leading
    // keyword to a prec-2 named token (`*_kw`) so it tokenizes as a keyword
    // rather than as `value`/`identifier` — that is what lets the header win
    // at line start (where `command_line` would otherwise consume the line via
    // the generic `identifier` + `repeat(arg)` fallback).
    //
    // LEXER COMMIT SAFETY: tree-sitter's lexer commits to the prec-2 keyword
    // tokenization whenever the keyword text appears, even in mid-line
    // positions where the parser COULD end the current rule and start a
    // sibling section. To keep `ip policy route-map BAR` and `switchport
    // access vlan 10` parsing as a single `command_line`, the section
    // keywords are also listed in `_cmd_arg` (aliased to `value`), so the
    // parser's arg-repeat can consume them as ordinary values.
    //
    // Each header carries a `field("name", ...)` (or for `line_header`, the
    // `type` + numeric args) so the LSP symbol table can index the definition
    // site. Bodies are uniform `repeat(choice($._nl, $._body_item))` — the
    // existing rich rules (`match_statement`, `set_statement`, `class_statement`,
    // `police_statement`, ...) all live in `_command` and thus work inside
    // these section bodies automatically.

    // Section-header keyword tokens (named so they can be aliased in
    // `_cmd_arg`). Each is prec-2 so it wins longest-match/tiebreak over the
    // generic `value`/`identifier` tokens at line start.
    route_map_kw: $ => token(prec(2, "route-map")),
    class_map_kw: $ => token(prec(2, "class-map")),
    policy_map_kw: $ => token(prec(2, "policy-map")),
    vlan_kw: $ => token(prec(2, "vlan")),
    line_kw: $ => token(prec(2, "line")),
    redundancy_kw: $ => token(prec(2, "redundancy")),

    route_map_section: $ => seq(
      $.route_map_header,
      repeat(choice($._nl, $._body_item)),
      $.eos,
    ),

    // `route-map NAME [permit|deny SEQ]`. The optional action+sequence tail
    // uses bare `$._cmd_arg` (NOT the prec-2 `permit`/`deny` keywords) because
    // in argument position the lexer expects `value`/`output` only; referencing
    // `permit_statement` here would call the rich-rule sub-tree, which is the
    // wrong shape.
    route_map_header: $ => prec.right(seq(
      $.route_map_kw,
      field("name", choice($.value, $.output)),
      repeat(field("arg", $._cmd_arg)),
    )),

    class_map_section: $ => seq(
      $.class_map_header,
      repeat(choice($._nl, $._body_item)),
      $.eos,
    ),

    // `class-map [match-any|match-all] NAME`. The explicit `choice(seq(...),
    // name)` avoids the GLR ambiguity between `class-map FOO` (just a name)
    // and `class-map match-any FOO` (match-type + name). `match-any`/
    // `match-all` lex as `value` in this position (not promoted to keywords).
    //
    // LONGEST-MATCH NOTE: `class-map` (9 chars, prec 2) wins over the existing
    // `class` keyword (5 chars, prec 2) at line start because tree-sitter's
    // lexer picks the longer token when precedence ties. Inside a
    // `policy_map_section` body, `class FOO` still tokenizes as the 5-char
    // `class` keyword (the next char isn't `-`), so `class_statement` is
    // unaffected.
    class_map_header: $ => prec.right(seq(
      $.class_map_kw,
      choice(
        seq(
          field("match_type", choice($.value, $.output)),
          field("name", choice($.value, $.output)),
        ),
        field("name", choice($.value, $.output)),
      ),
    )),

    policy_map_section: $ => seq(
      $.policy_map_header,
      repeat(choice($._nl, $._body_item)),
      $.eos,
    ),

    // `policy-map NAME`. `policy-map` (10 chars, prec 2) wins over `value`
    // matching "policy-map" (prec 1) on precedence and over `identifier`
    // matching "policy" (6 chars) on length.
    policy_map_header: $ => prec.right(seq(
      $.policy_map_kw,
      field("name", choice($.value, $.output)),
    )),

    vlan_section: $ => seq(
      $.vlan_header,
      repeat(choice($._nl, $._body_item)),
      $.eos,
    ),

    // `vlan N` (or `vlan NAME` for named VLANs in some contexts). The body
    // contains `name TEXT`, `private-vlan ...`, `remote-span`, etc.
    vlan_header: $ => prec.right(seq(
      $.vlan_kw,
      field("name", choice($.value, $.output)),
    )),

    line_section: $ => seq(
      $.line_header,
      repeat(choice($._nl, $._body_item)),
      $.eos,
    ),

    // `line (aux|console|vty) N [M]`. There is no single `name` field — the
    // section is identified by `(type, first_num, optional second_num)`. The
    // LSP symbol table synthesizes a stable key from these (e.g. `vty-0-4`).
    // `type` is kept as a field for downstream consumers; the numeric range
    // is left as bare args.
    line_header: $ => prec.right(seq(
      $.line_kw,
      field("type", choice($.value, $.output)),
      repeat(field("arg", choice($.value, $.output))),
    )),

    redundancy_section: $ => seq(
      $.redundancy_header,
      repeat(choice($._nl, $._body_item)),
      $.eos,
    ),

    // `redundancy` — singleton section (no name). The header is just the
    // keyword; `no redundancy` works through `section_header` dispatch.
    redundancy_header: $ => prec.right($.redundancy_kw),

    // --- ip access-list hierarchical section + numbered-ACL flat statement --
    //
    // Two related but distinct shapes are modeled here, both keyed on the
    // prec-2 `access_list_kw` token:
    //
    //   1. `ip access-list <standard|extended> NAME { body }` — a real
    //      hierarchical section (`ip_access_list_section` /
    //      `ip_access_list_header`). IOS opens a sub-mode (config-ext-nacl /
    //      config-std-nacl) whose body lines are ACE verbs (`permit` / `deny`
    //      via the existing `permit_statement` / `deny_statement` rules).
    //
    //   2. `access-list <N> permit|deny ...` — a FLAT top-level/global
    //      statement (`access_list_statement`). The numbered form does NOT
    //      open a sub-mode; the entire ACE lives on one line.
    //
    // LEXER COMMIT WORKAROUND: the leading keyword `access-list` is promoted
    // to a prec-2 named token (`access_list_kw`), parallel to the other six
    // section keywords above. Tree-sitter's lexer commits to that
    // tokenization whenever the literal `access-list` appears, including
    // mid-line in command_line arg position. To keep lines like
    //   ip access-list standard FOO         (GLR sibling: command_line(ip) ...)
    //   ip policy route-map BAR             (already covered by route_map_kw)
    // parsing uniformly, `access_list_kw` is aliased to `$.value` inside
    // `_cmd_arg` — see the comment block on `_cmd_arg` for the general
    // rationale. Without that alias, the prec-2 keyword would leak out of
    // `command_line`'s arg repeat and split the line into a broken
    // `command_line(ip) + spurious ip_access_list_section/access_list_statement`
    // pair.
    //
    // `ip` IS NOT PROMOTED. Promoting `ip` to prec-2 breaks every other
    // `ip ...` line in the grammar (ip access-group, ip helper-address, ip
    // route, ip verify, ...) because the lexer commits to the keyword and
    // tree-sitter does NOT re-lex; the prior Phase 1 attempt regressed
    // coverage by +344 errors (see the deferred-`ip address` comment above).
    // Instead, `ip_access_list_header` starts with a bare `$.identifier`
    // (the literal `ip`) and lets GLR fork against `command_line`. At the
    // second-token position, the lexer emits `access_list_kw` (11 chars,
    // prec 2) which both branches can accept (command_line via the alias in
    // `_cmd_arg`, the header directly) — the header wins via `prec.right`.
    // If `tree-sitter generate` reports a conflict for this fork, add
    // `[$.ip_access_list_header]` to the `conflicts` array at the top of
    // this file (template: the existing `[$.router_header]` entry).

    access_list_kw: $ => token(prec(2, "access-list")),

    ip_access_list_section: $ => seq(
      $.ip_access_list_header,
      repeat(choice($._nl, $._body_item)),
      $.eos,
    ),

    // `ip access-list <standard|extended> NAME`. The leading `ip` is a bare
    // identifier (NOT promoted — see above). After identifier, the parser
    // expects `access_list_kw`; the lexer produces it because prec-2 wins
    // length/precedence ties against the generic `value` matching the
    // literal `access-list`. The body is uniform with the other sections
    // (`repeat(choice($._nl, $._body_item))`), so the existing
    // `permit_statement` / `deny_statement` rules inside `_command` work as
    // ACE body lines automatically.
    //
    // `prec.right` is required so this header wins the GLR fork against the
    // alternative `command_line(ip)` parse at line start of
    // `ip access-list standard FOO` — without it the conflict resolves to
    // whichever branch tree-sitter happens to reduce first, which can leave
    // ACE body lines orphaned as top-level siblings.
    ip_access_list_header: $ => prec.right(seq(
      $.identifier,                                    // "ip"
      $.access_list_kw,                                // "access-list"
      field("type", choice($.value, $.output)),        // "standard" | "extended"
      field("name", choice($.value, $.output)),
    )),

    // `access-list <N> permit|deny ...` — flat numbered-ACL statement. The
    // leading `access_list_kw` (prec 2) is the longest-match token at line
    // start of `access-list 101 permit ip any any` (11 chars vs `identifier`
    // matching "access" at 6 chars), so `command_line` (which starts on
    // `identifier`) cannot match and every numbered-ACL line routes here.
    // This replaces the pre-rule parse shape
    //   command_line(access) + text("-list 101 permit ip any any")
    // with a single structured `access_list_statement` node whose `arg`
    // children carry the number, action, and ACE specifics. Body args stay
    // unstructured; downstream ACE resolution is the LSP's job.
    //
    // Registered in BOTH `_ios_statement` (top-level numbered ACLs) and
    // `_command` (so `negated_statement` and section bodies can host the
    // rare `no access-list 101 ...` and the even rarer mid-section form).
    access_list_statement: $ => prec.right(seq(
      $.access_list_kw,
      repeat(field("arg", $._cmd_arg)),
    )),

    // --- config-router / config-router-af "rich" sub-commands -------------
    // These OVERRIDE the generic `command_line` for high-frequency router
    // sub-commands. Each leading keyword is `token(prec(2, ...))` so it
    // tokenizes as a keyword rather than as `identifier`/`value` — that is
    // what lets the rich rule win inside `router_section` bodies and under
    // `negated_statement` (`no <rule>`).
    //
    // Hyphenated keywords (address-family, passive-interface, router-id,
    // metric-style, ...) are a particularly big win: the generic `value`
    // token includes `-`, so WITHOUT a prec-2 keyword the lexer either
    // longest-matches e.g. "address-family" as a single `value` (which
    // `command_line` cannot start on — it needs `identifier`) or splits
    // "address" | "-family ..." into a broken `command_line + text` pair.
    // `router-id` was even worse: the prec-2 `router` keyword hijacked the
    // first 6 chars and the line ERRORed. Promoting the hyphenated literal
    // to a prec-2 keyword fixes both — the keyword is longer than any
    // prefix competitor ("router-id" 8 > "router" 6) so tree-sitter's
    // longest-match picks it without disturbing `router_header`.
    //
    // Every rule here is GENERIC — `keyword + repeat(arg)` — so it catches
    // every `<kw> ...` line regardless of trailing args, and no line is
    // orphaned when the keyword is promoted past `identifier`. `repeat`
    // (not `repeat1`) is used so a BARE keyword (e.g. `passive-interface`
    // with no interface, `graceful-restart`, `default-information`) still
    // parses — same reasoning as config-if's `description_statement`.
    //
    // LANDED (verified against the coverage gate — no error/text regression):
    //   address-family, neighbor, network, redistribute, passive-interface,
    //   router-id, exit-address-family, metric-style, graceful-restart,
    //   queue-depth, compatible, auto-cost, aggregate-address, af-interface,
    //   autonomous-system, maximum-prefix, summary-prefix,
    //   default-information, distribute-list.
    //
    // DEFERRED:
    //   * `bgp ...` sub-commands (bgp bestpath, bgp cluster-id, ...) — `bgp`
    //     is ALREADY a prec-2 keyword via `routing_protocol`, so a `bgp ...`
    //     line inside a router body currently cannot fall back to
    //     `command_line` (its first token is the routing_protocol keyword,
    //     not `identifier`). A dedicated generic `bgp_router_statement` is
    //     feasible but intentionally left out of this batch; add + verify
    //     separately.
    //   * `timers`, `mpls`, `area`, `distance`, `bfd`, `eigrp` — multi-mode
    //     collision risk (several also appear in config-if / config-line /
    //     global); revisit as generic rules once this batch is confirmed.
    //   * `ip ...` router commands (e.g. `ip prefix-list`, `ip route` inside
    //     a router) — same lexer-commit trap as the config-if `ip address`
    //     rule documented above: promoting `ip` breaks every other
    //     `ip ...` command. Not attempted.

    address_family_statement: $ => prec.right(seq(
      token(prec(2, "address-family")),
      field("arg", repeat($._cmd_arg)),
    )),
    neighbor_statement: $ => prec.right(seq(
      token(prec(2, "neighbor")),
      field("arg", repeat($._cmd_arg)),
    )),
    network_statement: $ => prec.right(seq(
      token(prec(2, "network")),
      field("arg", repeat($._cmd_arg)),
    )),
    redistribute_statement: $ => prec.right(seq(
      token(prec(2, "redistribute")),
      field("arg", repeat($._cmd_arg)),
    )),
    passive_interface_statement: $ => prec.right(seq(
      token(prec(2, "passive-interface")),
      field("arg", repeat($._cmd_arg)),
    )),
    router_id_statement: $ => prec.right(seq(
      token(prec(2, "router-id")),
      field("arg", repeat($._cmd_arg)),
    )),
    // `exit-address-family` is a bare keyword with NO trailing args (it just
    // exits the AF sub-mode), so the rule is the keyword alone. Negation
    // (`no exit-address-family`) still works via the `negated_statement`
    // wrapper.
    exit_address_family_statement: $ => seq(
      token(prec(2, "exit-address-family")),
    ),
    metric_style_statement: $ => prec.right(seq(
      token(prec(2, "metric-style")),
      field("arg", repeat($._cmd_arg)),
    )),
    graceful_restart_statement: $ => prec.right(seq(
      token(prec(2, "graceful-restart")),
      field("arg", repeat($._cmd_arg)),
    )),
    queue_depth_statement: $ => prec.right(seq(
      token(prec(2, "queue-depth")),
      field("arg", repeat($._cmd_arg)),
    )),
    compatible_statement: $ => prec.right(seq(
      token(prec(2, "compatible")),
      field("arg", repeat($._cmd_arg)),
    )),
    auto_cost_statement: $ => prec.right(seq(
      token(prec(2, "auto-cost")),
      field("arg", repeat($._cmd_arg)),
    )),
    aggregate_address_statement: $ => prec.right(seq(
      token(prec(2, "aggregate-address")),
      field("arg", repeat($._cmd_arg)),
    )),
    af_interface_statement: $ => prec.right(seq(
      token(prec(2, "af-interface")),
      field("arg", repeat($._cmd_arg)),
    )),
    autonomous_system_statement: $ => prec.right(seq(
      token(prec(2, "autonomous-system")),
      field("arg", repeat($._cmd_arg)),
    )),
    maximum_prefix_statement: $ => prec.right(seq(
      token(prec(2, "maximum-prefix")),
      field("arg", repeat($._cmd_arg)),
    )),
    summary_prefix_statement: $ => prec.right(seq(
      token(prec(2, "summary-prefix")),
      field("arg", repeat($._cmd_arg)),
    )),
    default_information_statement: $ => prec.right(seq(
      token(prec(2, "default-information")),
      field("arg", repeat($._cmd_arg)),
    )),
    distribute_list_statement: $ => prec.right(seq(
      token(prec(2, "distribute-list")),
      field("arg", repeat($._cmd_arg)),
    )),

    // --- config (global) "rich" sub-commands --------------------------------
    // These OVERRIDE the generic `command_line` for high-frequency GLOBAL
    // config-mode keywords. Each leading keyword is `token(prec(2, ...))` so it
    // tokenizes as a keyword rather than as `identifier`/`value` — that is what
    // lets the rich rule win at top level, inside section bodies, and under
    // `negated_statement` (`no <rule>`).
    //
    // Every rule here is GENERIC — `keyword + repeat(arg)` — so it catches
    // every `<kw> ...` line regardless of trailing args, and no line is
    // orphaned when the keyword is promoted past `identifier` (the
    // lexer-commit trap documented in the config-if block above; the generic
    // tail is what makes these safe where SPECIFIC sub-rules would not be).
    // `repeat` (not `repeat1`) is used so a BARE keyword line still parses.
    //
    // Hyphenated keywords (snmp-server, hw-module, mac-address-table,
    // tacacs-server) are a big win for the same reason as the config-router
    // family: without a prec-2 keyword, `value` (which includes `-`)
    // longest-matches e.g. "snmp-server" as a single token that `command_line`
    // cannot start on (it needs `identifier`).
    //
    // Each target was verified against data/commands.json to be SINGLE-MODE
    // (every command starting with the keyword lives in `config`), so the
    // prec-2 promotion cannot collide with another mode's section body.
    //
    // LANDED (verified against the coverage gate — no error/text regression):
    //   snmp-server, scheduler, hw-module, memory, rtr, exception, subscriber,
    //   mac-address-table, kerberos, boot, tacacs-server, parser.
    //
    // DEFERRED:
    //   * `ip` (609 commands, 13 modes), `ipv6` (210, 12), `crypto` (136, 2),
    //     `mpls` (98, 7), `aaa` (83, 3), `mls` (57, 2), `logging` (54, 9),
    //     `platform` (43, 2), `ethernet` (31, 5), `spanning-tree` (23, 2),
    //     `monitor` (21, 5), `ntp` (19, 3), `track` (13, 2) — MULTI-MODE
    //     collision risk: each appears as a leading keyword in two or more
    //     sub-modes, so a generic `*_statement` here would lex the keyword in
    //     every section body and silently change how those sub-mode lines
    //     parse. A generic `ip_statement` would technically be safe at the
    //     lexer level (catches every ip-line) but adds no discrimination over
    //     `command_line`, and SPECIFIC ip-sub-rules (`ip_route_statement`)
    //     hit the lexer-commit trap (orphaning sibling ip-lines) — same root
    //     cause as the deferred config-if `ip address` rule. Not attempted.
    //   * `service` (47 commands) — already covered by the structured
    //     `service_statement` rule above.
    //   * `router` (8 commands) — already a section header keyword
    //     (`router_header`); a top-level `router ...` line is a
    //     `router_section`, not a global command, so no rich rule is wanted.
    //   * `menu`, `vlan`, `class-map`, `policy-map`, `controller`, `bridge-domain`
    //     — section/sub-mode header keywords in their own right (or scoped to
    //     a single sub-mode we do not yet model). Revisit when those sections
    //     land.

    snmp_server_statement: $ => prec.right(seq(
      token(prec(2, "snmp-server")),
      field("arg", repeat($._cmd_arg)),
    )),
    scheduler_statement: $ => prec.right(seq(
      token(prec(2, "scheduler")),
      field("arg", repeat($._cmd_arg)),
    )),
    hw_module_statement: $ => prec.right(seq(
      token(prec(2, "hw-module")),
      field("arg", repeat($._cmd_arg)),
    )),
    memory_statement: $ => prec.right(seq(
      token(prec(2, "memory")),
      field("arg", repeat($._cmd_arg)),
    )),
    rtr_statement: $ => prec.right(seq(
      token(prec(2, "rtr")),
      field("arg", repeat($._cmd_arg)),
    )),
    exception_statement: $ => prec.right(seq(
      token(prec(2, "exception")),
      field("arg", repeat($._cmd_arg)),
    )),
    subscriber_statement: $ => prec.right(seq(
      token(prec(2, "subscriber")),
      field("arg", repeat($._cmd_arg)),
    )),
    mac_address_table_statement: $ => prec.right(seq(
      token(prec(2, "mac-address-table")),
      field("arg", repeat($._cmd_arg)),
    )),
    kerberos_statement: $ => prec.right(seq(
      token(prec(2, "kerberos")),
      field("arg", repeat($._cmd_arg)),
    )),
    boot_statement: $ => prec.right(seq(
      token(prec(2, "boot")),
      field("arg", repeat($._cmd_arg)),
    )),
    tacacs_server_statement: $ => prec.right(seq(
      token(prec(2, "tacacs-server")),
      field("arg", repeat($._cmd_arg)),
    )),
    parser_statement: $ => prec.right(seq(
      token(prec(2, "parser")),
      field("arg", repeat($._cmd_arg)),
    )),

    // --- config-line "rich" sub-commands -----------------------------------
    // These OVERRIDE the generic `command_line` for high-frequency
    // config-line-mode keywords (console/vty/aux sub-commands). Each leading
    // keyword is `token(prec(2, ...))` so it tokenizes as a keyword rather than
    // as `identifier`/`value` — that is what lets the rich rule win at top
    // level, inside section bodies, and under `negated_statement`
    // (`no <rule>`).
    //
    // IMPORTANT: there is NO `line_section` in the grammar (only
    // `interface_section` and `router_section`). Real IOS `line vty 0 4` opens
    // a sub-mode, but in this grammar a `line <subcmd>` line parses at TOP
    // LEVEL just like a global command. So each rule below must be registered
    // in `_ios_statement` (top-level dispatch) AND in `_command` (used inside
    // section bodies and `negated_statement`) — see both lists above.
    //
    // Every rule here is GENERIC — `keyword + repeat(arg)` — so it catches
    // every `<kw> ...` line regardless of trailing args, and no line is
    // orphaned when the keyword is promoted past `identifier` (the
    // lexer-commit trap documented in the config-if block above; the generic
    // tail is what makes these safe where SPECIFIC sub-rules would not be).
    // `repeat` (not `repeat1`) is used so a BARE keyword line (e.g. `editing`,
    // `exec-banner`, `motd-banner`) still parses.
    //
    // Hyphenated keywords (exec-timeout, motd-banner, escape-character,
    // activation-character, access-class, terminal-type) are a big win for the
    // same reason as the config-router / config-global families: without a
    // prec-2 keyword, `value` (which includes `-`) longest-matches e.g.
    // "exec-timeout" as a single token that `command_line` cannot start on (it
    // needs `identifier`).
    //
    // Each target was verified against data/commands.json to be SINGLE-MODE
    // config-line (or, for a few, multi-mode but GENERIC-safe — see DEFERRED
    // notes) so the prec-2 promotion cannot orphan sibling lines in another
    // sub-mode.
    //
    // LANDED (verified against the coverage gate — no error/text regression):
    //   exec-timeout, login, password, transport, access-class, terminal-type,
    //   length, width, editing, motd-banner, escape-character,
    //   activation-character, databits, parity, padding, stopbits.
    //
    // DEFERRED:
    //   * `speed` — ALREADY covered by `speed_statement` (config-if family).
    //     `speed` is already a prec-2 keyword, so `line speed 9600` already
    //     parses structured; no new rule needed.
    //   * `authorization` — MULTI-MODE (config, config-dhcp, config-line).
    //     A generic rule would technically be safe but it adds keywords to two
    //     unrelated modes; revisit with more specific sub-rule coverage.
    //   * `history` — MULTI-MODE (config-if, config-ip-sla-dhcp, config-line,
    //     config-sla-y1731-delay). Revisit when those modes get richer rules.
    //   * `logging` — MULTI-MODE across 9 sub-modes (config, config-if,
    //     config-line, ...). Highest collision risk in the family. Skip until
    //     a mode-scoped promotion technique (external scanner / lookahead) is
    //     available.
    //   * `session-timeout` — only one command instance in
    //     config-auto-ip-sla-mpls-lpd-params; the data does not list
    //     config-line for it, so the value of a prec-2 promotion is marginal.
    //   * `exec`, `exec-banner`, `exec-character-bits`, `data-character-bits`,
    //     `disconnect-character`, `dispatch-character`, `dispatch-machine`,
    //     `dispatch-timeout`, `full-help`, `hold-character`, `autobaud`,
    //     `insecure`, `lockable`, `logout-warning`, `private`, `refuse-message`
    //     — all single-mode config-line and would be GENERIC-safe. Held back
    //     from this batch purely to keep the rule count focused on the
    //     highest-frequency commands; add in a follow-up batch.
    //
    // COLLISION NOTES:
    //   * `password` — coexists with the existing `service_password_recovery`
    //     prec-2 keyword (`password-recovery`). Tree-sitter's longest-match
    //     picks the longer literal where applicable, so
    //     `service password-recovery` still tokenizes the hyphenated form
    //     while a bare `password 0 mypass` (config-line) tokenizes the new
    //     8-char keyword. `enable password ...` / `username X password ...`
    //     never START a line with `password`, so the line-start promotion does
    //     not affect them (the embedded `password` arg tokenizes as `value`).
    //   * `transport` — multi-mode (config-if, config-l3vpn-encap-ip,
    //     config-ldap-server, config-pmipv6-lma-mll-cust, config-ptp-clk) but
    //     the GENERIC tail means every `transport ...` line in those other
    //     modes still parses structured, just under `transport_statement`
    //     instead of `command_line`. No coverage regression (verified).
    //   * `login` — multi-mode (config, config-line). The 3 config-mode
    //     commands (`login`, `login authentication`, `login on-success`) also
    //     parse fine under the generic tail.

    exec_timeout_statement: $ => prec.right(seq(
      token(prec(2, "exec-timeout")),
      field("arg", repeat($._cmd_arg)),
    )),
    login_statement: $ => prec.right(seq(
      token(prec(2, "login")),
      field("arg", repeat($._cmd_arg)),
    )),
    password_statement: $ => prec.right(seq(
      token(prec(2, "password")),
      field("arg", repeat($._cmd_arg)),
    )),
    transport_statement: $ => prec.right(seq(
      token(prec(2, "transport")),
      field("arg", repeat($._cmd_arg)),
    )),
    access_class_statement: $ => prec.right(seq(
      token(prec(2, "access-class")),
      field("arg", repeat($._cmd_arg)),
    )),
    terminal_type_statement: $ => prec.right(seq(
      token(prec(2, "terminal-type")),
      field("arg", repeat($._cmd_arg)),
    )),
    length_statement: $ => prec.right(seq(
      token(prec(2, "length")),
      field("arg", repeat($._cmd_arg)),
    )),
    width_statement: $ => prec.right(seq(
      token(prec(2, "width")),
      field("arg", repeat($._cmd_arg)),
    )),
    editing_statement: $ => prec.right(seq(
      token(prec(2, "editing")),
      field("arg", repeat($._cmd_arg)),
    )),
    motd_banner_statement: $ => prec.right(seq(
      token(prec(2, "motd-banner")),
      field("arg", repeat($._cmd_arg)),
    )),
    escape_character_statement: $ => prec.right(seq(
      token(prec(2, "escape-character")),
      field("arg", repeat($._cmd_arg)),
    )),
    activation_character_statement: $ => prec.right(seq(
      token(prec(2, "activation-character")),
      field("arg", repeat($._cmd_arg)),
    )),
    databits_statement: $ => prec.right(seq(
      token(prec(2, "databits")),
      field("arg", repeat($._cmd_arg)),
    )),
    parity_statement: $ => prec.right(seq(
      token(prec(2, "parity")),
      field("arg", repeat($._cmd_arg)),
    )),
    padding_statement: $ => prec.right(seq(
      token(prec(2, "padding")),
      field("arg", repeat($._cmd_arg)),
    )),
    stopbits_statement: $ => prec.right(seq(
      token(prec(2, "stopbits")),
      field("arg", repeat($._cmd_arg)),
    )),

    // --- access-list (ACE) "rich" rules ------------------------------------
    // These OVERRIDE the generic `command_line` for the two universal ACE
    // verbs (`permit` / `deny`) that start every line in the ACL sub-modes
    // (config-ext-nacl, config-std-nacl, config-ipv6-acl, config-ext-macl,
    // config-source-guard). Each leading keyword is `token(prec(2, ...))` so
    // it tokenizes as a keyword rather than as `identifier`/`value` — that is
    // what lets the rich rule win at top level, inside section bodies, and
    // under `negated_statement` (`no permit ...` / `no deny ...`).
    //
    // IMPORTANT: there is NO `access_list_section` in the grammar (only
    // `interface_section` and `router_section`). Real IOS `ip access-list
    // extended FOO` opens a sub-mode, but in this grammar the ACE lines parse
    // at TOP LEVEL just like global commands. So each rule must be registered
    // in `_ios_statement` (top-level dispatch) AND in `_command` (used inside
    // section bodies and `negated_statement`) — see both lists above.
    //
    // These rules are GENERIC ACE catch-alls — `keyword + repeat(arg)` — so
    // they catch EVERY `permit ...` / `deny ...` line regardless of trailing
    // args, and no line is orphaned when the keyword is promoted past
    // `identifier` (the lexer-commit trap documented in the config-if block
    // above; the generic tail is what makes these safe where SPECIFIC sub-
    // rules for `permit ip` / `permit tcp` / `host` / `any` / `eq` / `
    // `established` would not be — those would orphan every sibling ACE form
    // whose leading keyword was not promoted). `repeat` (not `repeat1`) is
    // used so a BARE `permit`/`deny` (rare but valid in some evaluation
    // forms) still parses.
    //
    // The tail is intentionally generic — protocol/address/port fields are
    // NOT separated into named fields here. Multi-word ACE identity (protocol
    // + src-wildcard + dst-wildcard + port-operator + flags) is resolved
    // downstream by the LSP against data/commands.json, NOT by the AST; the
    // generic repeat(arg) already gives a structured named node for every
    // ACE line, which is what the coverage tooling keys on. A more specific
    // ACE grammar (separating `ip`/`tcp`/`udp`/`icmp`, `host`/`any`/CIDR,
    // `eq`/`gt`/`lt`/`range`, `established`/`log`/`fragments`) is a
    // possible future refinement once a mode-scoped promotion technique
    // (external scanner / lookahead) is available to safely distinguish the
    // `permit`/`deny` line-start case from `route-map X permit 10` (where
    // `permit` is NOT a line start, so it stays a `value` arg of
    // `route-map`).
    //
    // SAFETY: data/commands.json confirms `permit`/`deny` appear as the
    // FIRST token of a command ONLY in the five ACL/mACL modes above. Every
    // other use of `permit`/`deny` (route-map bodies, policy-map bodies, the
    // `ipv6 prefix-list` delegation, etc.) starts the line with a different
    // keyword, so promoting `permit`/`deny` to prec-2 keywords does NOT
    // collide with any non-ACL form.

    permit_statement: $ => prec.right(seq(
      token(prec(2, "permit")),
      field("action_args", repeat($._cmd_arg)),
    )),
    deny_statement: $ => prec.right(seq(
      token(prec(2, "deny")),
      field("action_args", repeat($._cmd_arg)),
    )),

    // --- rich misc "sub-commands" --------------------------------------------
    // These OVERRIDE the generic `command_line` for high-frequency keywords
    // across the vlan / class-map / policy-map (+ policy-map-class) /
    // redundancy / route-map sub-modes. Each leading keyword is
    // `token(prec(2, ...))` so it tokenizes as a keyword rather than as
    // `identifier`/`value` — that is what lets the rich rule win at top level,
    // inside section bodies, and under `negated_statement` (`no <rule>`).
    //
    // IMPORTANT: there are NO vlan/class-map/policy-map/redundancy/route-map
    // sections in the grammar (only `interface_section` and `router_section`).
    // Real IOS `class-map FOO` / `policy-map FOO` / `vlan 10` / `redundancy` /
    // `route-map FOO` open sub-modes, but in this grammar their BODIES parse
    // at TOP LEVEL just like global commands. So each rule must be registered
    // in `_ios_statement` (top-level dispatch) AND in `_command` (used inside
    // section bodies and `negated_statement`) — see both lists above.
    //
    // GENERIC vs SPECIFIC: `match` / `set` / `class` are intentional GENERIC
    // rules spanning multiple map/cmap/pmap modes. The GENERIC tail
    // (`repeat(arg)`) catches every `match ...` / `set ...` / `class ...` line
    // in EVERY sub-mode (class-map, route-map, policy-map, crypto-map,
    // pfr-map, ...), so no line is orphaned when the keyword is promoted past
    // `identifier` (the lexer-commit trap documented in the config-if block
    // above). The data confirms this: `match` appears as a line-leading
    // keyword in 12 modes, `set` in 8 modes, `class` in 4 modes — a SPECIFIC
    // per-mode rule would orphan sibling lines in every other mode, but the
    // generic tail is safe because the prec-2 keyword always leads into the
    // same `repeat(arg)` shape regardless of trailing argument structure.
    //
    // `class` vs `class-map` longest-match: `class-map` is a 9-char hyphenated
    // literal that has NO prec-2 keyword in this grammar, but a `class-map
    // FOO` line STILL parses (verified) because tree-sitter's lexer commits to
    // the prec-2 `class` keyword (5 chars) and the residual `-map FOO` falls
    // through to `text` — i.e. `class-map FOO` parses as `class_statement` +
    // `text` (still "structured" by coverage, same shape as the pre-rule
    // `command_line(class) + text(-map FOO)` it replaced). NO error, no
    // regression. (Precedence wins over length in tree-sitter's lexer; if a
    // FUTURE `class_map_statement` rule is added, register it ahead of
    // `class_statement` in `_command`/`_ios_statement` and give it a longer
    // `token(prec(2, "class-map"))` keyword.)
    //
    // Each target was verified against data/commands.json + the coverage gate.
    //
    // LANDED (verified against the coverage gate — no error/text regression):
    //   match, set, class (GENERIC — multi-mode but safe via generic tail),
    //   remote-span, private-vlan (vlan), police, priority, drop, random-detect
    //   (policy-map-class), auto-sync (redundancy), continue (route-map).
    //
    // DEFERRED:
    //   * `route-map` / `policy-map` / `class-map` / `vlan` / `redundancy`
    //     themselves — these are SECTION-HEADER keywords in their own right
    //     (each opens a sub-mode). The grammar does not yet model those
    //     sections, so a `route-map FOO permit 10` line currently parses as
    //     `command_line(route) + text(-map FOO permit 10)`. Promoting the
    //     hyphenated header to a prec-2 keyword is the natural next step but
    //     is held back until dedicated `<header>_section` rules land (the
    //     header alone without a section body would just be a flat line).
    //   * `bandwidth`, `queue-limit`, `service-policy`, `shape`, `trust`,
    //     `inspect`, `fair-queue`, `estimate`, `account`, `admit`, `acl`,
    //     `redirect`, `optimize`, `log`, `passthrough`, `copy` — all
    //     single-mode config-pmap-c and would be GENERIC-safe, but lower
    //     frequency. Held back to keep the rule count focused; add in a
    //     follow-up batch.
    //   * `description`, `shape` — appear in BOTH config-cmap and config-pmap-c
    //     (and `description` is already covered by the config-if family's
    //     `description_statement`); the existing rules already handle them.

    match_statement: $ => prec.right(seq(
      token(prec(2, "match")),
      field("arg", repeat($._cmd_arg)),
    )),
    set_statement: $ => prec.right(seq(
      token(prec(2, "set")),
      field("arg", repeat($._cmd_arg)),
    )),
    class_statement: $ => prec.right(seq(
      token(prec(2, "class")),
      field("arg", repeat($._cmd_arg)),
    )),
    remote_span_statement: $ => prec.right(seq(
      token(prec(2, "remote-span")),
      field("arg", repeat($._cmd_arg)),
    )),
    private_vlan_statement: $ => prec.right(seq(
      token(prec(2, "private-vlan")),
      field("arg", repeat($._cmd_arg)),
    )),
    police_statement: $ => prec.right(seq(
      token(prec(2, "police")),
      field("arg", repeat($._cmd_arg)),
    )),
    priority_statement: $ => prec.right(seq(
      token(prec(2, "priority")),
      field("arg", repeat($._cmd_arg)),
    )),
    drop_statement: $ => prec.right(seq(
      token(prec(2, "drop")),
      field("arg", repeat($._cmd_arg)),
    )),
    random_detect_statement: $ => prec.right(seq(
      token(prec(2, "random-detect")),
      field("arg", repeat($._cmd_arg)),
    )),
    auto_sync_statement: $ => prec.right(seq(
      token(prec(2, "auto-sync")),
      field("arg", repeat($._cmd_arg)),
    )),
    continue_statement: $ => prec.right(seq(
      token(prec(2, "continue")),
      field("arg", repeat($._cmd_arg)),
    )),

    negated_statement: $ => seq(
      $.negation_keyword,
      field("keyword", choice($._command, $.section_header)),
    ),

    negation_keyword: $ => token(prec(2, "no")),

    service_statement: $ => seq(
      token(prec(2, "service")),
      choice(
        prec(1, $.output),
        field("keyword", choice(
          $.timestamps,
          $.counters,
          $.prompt,
          alias($.service_pad, $.pad),
          alias($.service_password_recovery, $.password_recovery),
          alias($.service_compress_config, $.compress_config),
          alias($.service_linenumber, $.linenumber),
          alias($.service_nagle, $.nagle),
          alias($.service_tcp_keepalive_in, $.tcp_keepalive_in),
          alias($.service_tcp_keepalive_out, $.tcp_keepalive_out),
          $.tcp_small_servers,
          $.udp_small_servers,
        )),
        prec(-1, repeat1(field("arg", $._cmd_arg))),
      ),
    ),

    service_pad: $ => token(prec(2, "pad")),
    service_password_recovery: $ => token(prec(2, "password-recovery")),
    service_compress_config: $ => token(prec(2, "compress-config")),
    service_linenumber: $ => token(prec(2, "linenumber")),
    service_nagle: $ => token(prec(2, "nagle")),
    service_tcp_keepalive_in: $ => token(prec(2, "tcp-keepalives-in")),
    service_tcp_keepalive_out: $ => token(prec(2, "tcp-keepalives-out")),

    tcp_small_servers: $ => seq(
      token(prec(2, "tcp-small-servers")),
      optional(field("keyword", choice($.no_limit, $.max_servers))),
    ),

    udp_small_servers: $ => seq(
      token(prec(2, "udp-small-servers")),
      optional(field("keyword", choice($.no_limit, $.max_servers))),
    ),

    no_limit: $ => token(prec(2, "no-limit")),

    max_servers: $ => seq(
      token(prec(2, "max-servers")),
      field("keyword", choice($.value, $.output)),
    ),

    prompt: $ => seq(
      token(prec(2, "prompt")),
      field("keyword", alias($.service_prompt_config, $.config)),
    ),
    service_prompt_config: $ => token(prec(2, "config")),

    counters: $ => seq(
      token(prec(2, "counters")),
      field("keyword", $.max),
    ),

    max: $ => seq(
      token(prec(2, "max")),
      field("keyword", $.age),
    ),

    age: $ => seq(
      token(prec(2, "age")),
      choice($.value, $.output),
    ),

    timestamps: $ => choice(
      prec(2, seq(
        token(prec(2, "timestamps")),
        field("keyword", choice($.debug, $.log)),
        optional(choice(
          seq(
            $.datetime,
            optional($.msec),
            repeat(choice($.localtime, $.show_timezone, $.year)),
          ),
          seq(
            $.uptime,
            repeat(choice($.localtime, $.show_timezone, $.year)),
          ),
        )),
      )),
      prec(1, token(prec(2, "timestamps"))),
    ),

    debug: $ => token(prec(2, "debug")),
    log: $ => token(prec(2, "log")),
    datetime: $ => token(prec(2, "datetime")),
    uptime: $ => token(prec(2, "uptime")),
    msec: $ => token(prec(2, "msec")),
    localtime: $ => token(prec(2, "localtime")),
    show_timezone: $ => token(prec(2, "show-timezone")),
    year: $ => token(prec(2, "year")),

    for_statement: ($) =>
      seq(
        statement("for", field("iteration", expression_in_statement($))),
        field("body", repeat($._item)),
        choice($.for_else_statement, statement("endfor")),
      ),
    for_else_statement: ($) =>
      seq(
        statement("else"),
        field("body", repeat($._item)),
        statement("endfor"),
      ),

    if_statement: ($) =>
      seq(
        statement("if", field("condition", expression_in_statement($))),
        field("body", repeat($._item)),
        field("elif", repeat($.elif_statement)),
        choice(field("else", $.else_statement), statement("endif")),
      ),

    elif_statement: ($) =>
      seq(
        statement("elif", field("condition", expression_in_statement($))),
        repeat($._item),
      ),

    else_statement: ($) =>
      seq(
        statement("else"),
        field("body", repeat($._item)),
        statement("endif"),
      ),

    macro_statement: ($) =>
      seq(
        statement("macro", field("signature", expression_in_statement($))),
        repeat($._item),
        statement("endmacro"),
      ),

    call_statement: ($) =>
      seq(
        statement("call", field("call", expression_in_statement($))),
        repeat($._item),
        statement("endcall"),
      ),

    filter_statement: ($) =>
      seq(
        statement("filter", field("code", expression_in_statement($))),
        repeat($._item),
        statement("endfilter"),
      ),

    assignment_statement: ($) =>
      statement("set", field("code", expression_in_statement($))),

    end_assignment_statement: ($) => statement("endset"),

    extends_statement: ($) => statement("extends", expression_in_statement($)),

    block_statement: ($) =>
      seq(
        statement(
          "block",
          field("id", $.identifier),
          optional(keyword("scoped")),
          optional(keyword("required")),
        ),
        repeat($._item),
        statement("endblock", optional($.identifier)),
      ),

    include_statement: ($) =>
      statement(
        "include",
        choice($.string, $.identifier),
        optional(alias("ignore missing", "_keyword")),
        optional(context_specifier()),
      ),
    import_statement: ($) =>
      choice(
        statement(
          "import",
          field("id", $.string),
          alias("as", "_keyword"),
          $.identifier,
          optional(context_specifier()),
        ),
        statement(
          "from",
          field("id", $.string),
          keyword("import"),
          sep1(
            choice(
              $.identifier,
              seq($.identifier, keyword("as"), $.identifier),
            ),
            ",",
          ),
          optional(context_specifier()),
        ),
      ),

    with_statement: ($) =>
      seq(
        statement(
          "with",
          optional(field("assignment", expression_in_statement($))),
        ),
        repeat($._item),
        statement("endwith"),
      ),

    raw_statement: ($) =>
      seq(
        alias(
          token(seq(statement_start(), /\s*raw\s*/, statement_end())),
          "raw_start",
        ),
        $.text,
        alias(
          token(seq(statement_start(), /\s*endraw\s*/, statement_end())),
          "raw_end",
        ),
      ),

    custom_statement: ($) =>
      prec.dynamic(
        -1,
        seq(
          statement_start(),
          alias($._expression_in_statement, $.custom_tag),
          statement_end(),
        ),
      ),

    identifier: () => /[\w]+/,

    string: () => choice(seq(`"`, /[^\"]+/, `"`), seq(`'`, /[^\']+/, `'`)),

    value: _ => token(prec(1, /[a-zA-Z0-9\.\-\/:,]+/)),
  }
});
