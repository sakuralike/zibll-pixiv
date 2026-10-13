<?php
/**
 * Settings and local ID blocklist.
 *
 * @package Zibll_Pixiv
 */

if (! defined('ABSPATH')) {
    exit;
}

final class Zibll_Pixiv_Settings
{
    public const OPTION_KEY = 'zibll_pixiv_options';

    public const VERSION_OPTION = 'zibll_pixiv_version';

    /**
     * @return array<string,mixed>
     */
    public static function defaults(): array
    {
        return array(
            'slug'            => 'pixiv',
            'primary_domain'  => 'pixiv.re',
            'backup_domain'   => 'pixiv.nl',
            'failover'        => 1,
            'timeout'         => 15,
            'disclaimer'      => '本页图片版权归 Pixiv 原作者所有。本工具仅提供技术性图片预览，不存储、不分发、不用于商业用途。请仅作个人学习与欣赏使用，并前往 Pixiv 支持原作者。',
            'contact'         => '',
            'page_title'      => 'Pixiv 图片查看器',
            'filter_enabled'  => 0,
            'blocklist'       => '',
            'record_blocked'  => 0,
            'blocked_message' => '该作品已被本站屏蔽',
        );
    }

    /**
     * @return array<string,mixed>
     */
    public static function get(): array
    {
        $stored = get_option(self::OPTION_KEY, array());
        if (! is_array($stored)) {
            $stored = array();
        }

        return wp_parse_args($stored, self::defaults());
    }

    /**
     * Add the WordPress settings page.
     */
    public static function register(): void
    {
        register_setting(
            'zibll_pixiv_settings',
            self::OPTION_KEY,
            array(
                'type'              => 'array',
                'sanitize_callback' => array(__CLASS__, 'sanitize'),
                'default'           => self::defaults(),
            )
        );

        add_settings_section(
            'zibll_pixiv_main',
            __('查看器设置', 'zibll-pixiv'),
            array(__CLASS__, 'render_section'),
            'zibll-pixiv'
        );

        $fields = array(
            'slug'            => __('独立页面 slug', 'zibll-pixiv'),
            'primary_domain'  => __('主代理域名', 'zibll-pixiv'),
            'backup_domain'   => __('备用代理域名', 'zibll-pixiv'),
            'failover'        => __('自动故障转移', 'zibll-pixiv'),
            'timeout'         => __('请求超时（秒）', 'zibll-pixiv'),
            'page_title'      => __('页面标题', 'zibll-pixiv'),
            'disclaimer'      => __('免责声明文案', 'zibll-pixiv'),
            'contact'         => __('版权方联系方式', 'zibll-pixiv'),
            'filter_enabled'  => __('ID 屏蔽清单开关', 'zibll-pixiv'),
            'blocklist'       => __('屏蔽清单内容', 'zibll-pixiv'),
            'record_blocked'  => __('记录被屏蔽 ID', 'zibll-pixiv'),
            'blocked_message' => __('命中后的提示文案', 'zibll-pixiv'),
        );

        foreach ($fields as $key => $label) {
            add_settings_field(
                'zibll_pixiv_' . $key,
                $label,
                array(__CLASS__, 'render_field'),
                'zibll-pixiv',
                'zibll_pixiv_main',
                array('key' => $key)
            );
        }
    }

    /**
     * Add settings menu after WordPress is ready.
     */
    public static function add_menu(): void
    {
        add_options_page(
            __('Zibll Pixiv', 'zibll-pixiv'),
            __('Zibll Pixiv', 'zibll-pixiv'),
            'manage_options',
            'zibll-pixiv',
            array(__CLASS__, 'render_page')
        );
    }

    public static function render_section(): void
    {
        echo '<p>' . esc_html__('配置独立查看器、代理域名和按 ID 精确匹配的本地屏蔽清单。插件不会把图片经由服务器中转。', 'zibll-pixiv') . '</p>';
    }

    /**
     * Render one field.
     *
     * @param array{key:string} $args Field args.
     */
    public static function render_field(array $args): void
    {
        $key     = $args['key'];
        $options = self::get();
        $value   = $options[$key] ?? '';
        $name    = self::OPTION_KEY . '[' . $key . ']';

        if (in_array($key, array('failover', 'filter_enabled', 'record_blocked'), true)) {
            printf(
                '<label><input type="checkbox" name="%1$s" value="1" %2$s /> %3$s</label>',
                esc_attr($name),
                checked((bool) $value, true, false),
                esc_html__('启用', 'zibll-pixiv')
            );
        } elseif ($key === 'disclaimer' || $key === 'contact' || $key === 'blocklist') {
            printf(
                '<textarea class="large-text" rows="%1$d" name="%2$s">%3$s</textarea>',
                $key === 'blocklist' ? 8 : 5,
                esc_attr($name),
                esc_textarea((string) $value)
            );
            if ($key === 'blocklist') {
                echo '<p class="description">' . esc_html__('每行一个作品 ID 或 user:画师ID；支持 # 注释。清单不会输出到访客页面。', 'zibll-pixiv') . '</p>';
            }
        } else {
            $type = $key === 'timeout' ? 'number' : 'text';
            printf(
                '<input class="regular-text" type="%1$s" name="%2$s" value="%3$s" />',
                esc_attr($type),
                esc_attr($name),
                esc_attr((string) $value)
            );
        }
    }

    public static function render_page(): void
    {
        if (! current_user_can('manage_options')) {
            return;
        }

        $options = self::get();
        $status  = self::blocklist_status($options);
        ?>
        <div class="wrap">
            <h1><?php echo esc_html__('Zibll Pixiv', 'zibll-pixiv'); ?></h1>
            <form action="options.php" method="post">
                <?php
                settings_fields('zibll_pixiv_settings');
                do_settings_sections('zibll-pixiv');
                submit_button();
                ?>
            </form>
            <hr />
            <h2><?php echo esc_html__('ID 屏蔽状态', 'zibll-pixiv'); ?></h2>
            <p><strong><?php echo esc_html($status['label']); ?></strong></p>
            <p><?php echo esc_html__('该功能只按管理员维护的作品 ID / 画师 ID 精确匹配，不是自动内容识别。', 'zibll-pixiv'); ?></p>
            <form action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post">
                <input type="hidden" name="action" value="zibll_pixiv_flush_rewrite" />
                <?php wp_nonce_field('zibll_pixiv_flush_rewrite'); ?>
                <?php submit_button(__('重建伪静态', 'zibll-pixiv'), 'secondary', 'submit', false); ?>
            </form>
            <p class="description"><?php echo esc_html__('如果独立页面返回 404，请确认 nginx 已将未命中路径交给 WordPress index.php。', 'zibll-pixiv'); ?></p>
        </div>
        <?php
    }

    /**
     * Sanitize all settings without accepting arbitrary proxy URLs.
     *
     * @param mixed $input Submitted settings.
     * @return array<string,mixed>
     */
    public static function sanitize($input): array
    {
        $input = is_array($input) ? $input : array();
        $defaults = self::defaults();
        $output = $defaults;

        $slug = sanitize_title($input['slug'] ?? $defaults['slug']);
        $output['slug'] = $slug !== '' ? $slug : $defaults['slug'];
        $output['primary_domain'] = Zibll_Pixiv_Request_Policy::normalize_domain($input['primary_domain'] ?? '', $defaults['primary_domain']);
        $output['backup_domain'] = Zibll_Pixiv_Request_Policy::normalize_domain($input['backup_domain'] ?? '', $defaults['backup_domain']);
        $output['failover'] = empty($input['failover']) ? 0 : 1;
        $output['filter_enabled'] = empty($input['filter_enabled']) ? 0 : 1;
        $output['record_blocked'] = empty($input['record_blocked']) ? 0 : 1;
        $output['timeout'] = max(3, min(30, absint($input['timeout'] ?? $defaults['timeout'])));
        $output['page_title'] = sanitize_text_field($input['page_title'] ?? $defaults['page_title']);
        $output['disclaimer'] = wp_kses_post($input['disclaimer'] ?? $defaults['disclaimer']);
        $output['contact'] = sanitize_textarea_field($input['contact'] ?? '');
        $output['blocklist'] = self::normalize_blocklist((string) ($input['blocklist'] ?? ''));
        $output['blocked_message'] = sanitize_text_field($input['blocked_message'] ?? $defaults['blocked_message']);
        if ($output['blocked_message'] === '') {
            $output['blocked_message'] = $defaults['blocked_message'];
        }

        return $output;
    }

    /**
     * Keep only valid work/user entries and comments.
     */
    public static function normalize_blocklist(string $raw): string
    {
        $lines = preg_split('/\R/u', $raw) ?: array();
        $valid = array();
        foreach ($lines as $line) {
            $line = trim((string) $line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            $line = preg_replace('/\s+#.*$/u', '', $line);
            if (preg_match('/^[1-9]\d{0,11}$/', (string) $line) || preg_match('/^user:[1-9]\d{0,11}$/i', (string) $line)) {
                $valid[] = strtolower((string) $line);
            }
        }

        return implode("\n", array_values(array_unique($valid)));
    }

    /**
     * @return array{enabled:bool,count:int,effective:bool,label:string}
     */
    public static function blocklist_status(?array $options = null): array
    {
        $options = $options ?? self::get();
        $entries = self::parse_blocklist((string) ($options['blocklist'] ?? ''));
        $enabled = ! empty($options['filter_enabled']);
        $effective = $enabled && ! empty($entries);

        if (! $enabled) {
            $label = __('未生效：屏蔽未启用', 'zibll-pixiv');
        } elseif (empty($entries)) {
            $label = __('未生效：清单为空', 'zibll-pixiv');
        } else {
            $label = sprintf(__('当前生效（%d 条规则）', 'zibll-pixiv'), count($entries));
        }

        return array(
            'enabled'   => $enabled,
            'count'     => count($entries),
            'effective' => $effective,
            'label'     => $label,
        );
    }

    /**
     * @return string[]
     */
    public static function parse_blocklist(string $raw): array
    {
        $normalized = self::normalize_blocklist($raw);
        return $normalized === '' ? array() : explode("\n", $normalized);
    }

    /**
     * Check one parsed artwork before the browser contacts the proxy.
     *
     * @return array{blocked:bool,reason:string}
     */
    public static function match_blocklist(string $id, string $user_id = '', ?array $options = null): array
    {
        $options = $options ?? self::get();
        $entries  = self::parse_blocklist((string) ($options['blocklist'] ?? ''));
        if (empty($options['filter_enabled']) || empty($entries)) {
            return array('blocked' => false, 'reason' => 'disabled');
        }

        if (in_array($id, $entries, true)) {
            return array('blocked' => true, 'reason' => 'artwork');
        }

        if ($user_id !== '' && in_array('user:' . $user_id, $entries, true)) {
            return array('blocked' => true, 'reason' => 'user');
        }

        return array('blocked' => false, 'reason' => 'not_found');
    }

    /**
     * Store a small administrator-only rolling list.
     */
    public static function record_block_hit(string $id, string $user_id, string $reason): void
    {
        $existing = get_option('zibll_pixiv_blocked_log', array());
        $existing = is_array($existing) ? $existing : array();
        array_unshift(
            $existing,
            array(
                'id'       => $id,
                'user_id'  => $user_id,
                'reason'   => $reason,
                'time_gmt' => current_time('mysql', true),
            )
        );
        update_option('zibll_pixiv_blocked_log', array_slice($existing, 0, 100), false);
    }

    public static function flush_rewrite_action(): void
    {
        if (! current_user_can('manage_options') || ! check_admin_referer('zibll_pixiv_flush_rewrite')) {
            wp_die(esc_html__('无权限执行该操作。', 'zibll-pixiv'));
        }

        Zibll_Pixiv_Rewrite::register();
        flush_rewrite_rules();
        wp_safe_redirect(add_query_arg('zibll_pixiv_flushed', '1', admin_url('options-general.php?page=zibll-pixiv')));
        exit;
    }
}
