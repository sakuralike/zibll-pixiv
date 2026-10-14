<?php
/**
 * Main plugin controller.
 *
 * @package Zibll_Pixiv
 */

if (! defined('ABSPATH')) {
    exit;
}

final class Zibll_Pixiv_Plugin
{
    private static ?self $instance = null;

    private bool $assets_enqueued = false;

    public static function instance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    private function __construct()
    {
        add_action('init', array('Zibll_Pixiv_Rewrite', 'register'), 5);
        add_filter('query_vars', array('Zibll_Pixiv_Rewrite', 'query_vars'));
        add_filter('pre_handle_404', array('Zibll_Pixiv_Rewrite', 'prevent_404'), 10, 2);
        add_filter('template_include', array('Zibll_Pixiv_Rewrite', 'template_include'), 99);
        add_action('init', array($this, 'register_shortcode'), 20);
        add_action('rest_api_init', array('Zibll_Pixiv_Rest_Api', 'register'));

        add_action('admin_init', array('Zibll_Pixiv_Settings', 'register'));
        add_action('admin_menu', array('Zibll_Pixiv_Settings', 'add_menu'));
        add_action('admin_post_zibll_pixiv_flush_rewrite', array('Zibll_Pixiv_Settings', 'flush_rewrite_action'));
        add_action('admin_notices', array($this, 'admin_notices'));
        add_filter('plugin_action_links_' . plugin_basename(ZIBLL_PIXIV_FILE), array($this, 'action_links'));
        add_action('wp_enqueue_scripts', array($this, 'enqueue_assets'));
        add_action('update_option_' . Zibll_Pixiv_Settings::OPTION_KEY, array($this, 'settings_updated'), 10, 3);

        // A blocked initial route is evaluated on the server before any proxy URL is sent to the browser.
        add_filter('body_class', array($this, 'body_class'));
    }

    public static function activate(): void
    {
        if (! get_option(Zibll_Pixiv_Settings::OPTION_KEY)) {
            add_option(Zibll_Pixiv_Settings::OPTION_KEY, Zibll_Pixiv_Settings::defaults(), '', false);
        }
        update_option(Zibll_Pixiv_Settings::VERSION_OPTION, ZIBLL_PIXIV_VERSION, false);
        Zibll_Pixiv_Rewrite::register();
        flush_rewrite_rules();
    }

    public static function deactivate(): void
    {
        flush_rewrite_rules();
    }

    public function settings_updated($old_value, $value, $option): void
    {
        if ($old_value !== $value) {
            Zibll_Pixiv_Rewrite::register();
            flush_rewrite_rules();
        }
    }

    public function register_shortcode(): void
    {
        add_shortcode('zibll_pixiv_viewer', array('Zibll_Pixiv_Rewrite', 'shortcode'));
    }

    public function enqueue_assets(): void
    {
        if ($this->assets_enqueued || ! $this->should_enqueue_assets()) {
            return;
        }

        $this->assets_enqueued = true;
        $options = Zibll_Pixiv_Settings::get();
        $status = Zibll_Pixiv_Settings::blocklist_status($options);
        wp_enqueue_style(
            'zibll-pixiv-viewer',
            ZIBLL_PIXIV_URL . 'assets/css/viewer.css',
            array(),
            ZIBLL_PIXIV_VERSION . '.' . filemtime(ZIBLL_PIXIV_DIR . 'assets/css/viewer.css')
        );
        wp_enqueue_script(
            'zibll-pixiv-viewer',
            ZIBLL_PIXIV_URL . 'assets/js/viewer.js',
            array(),
            ZIBLL_PIXIV_VERSION . '.' . filemtime(ZIBLL_PIXIV_DIR . 'assets/js/viewer.js'),
            true
        );

        $context = array(
            'baseUrl'          => Zibll_Pixiv_Rewrite::base_url(),
            'prettyPermalinks' => (bool) get_option('permalink_structure'),
            'primaryDomain'    => Zibll_Pixiv_Request_Policy::normalize_domain($options['primary_domain'], 'pixiv.re'),
            'backupDomain'     => Zibll_Pixiv_Request_Policy::normalize_domain($options['backup_domain'], 'pixiv.nl'),
            'failover'         => ! empty($options['failover']),
            'timeout'          => max(3, min(30, (int) $options['timeout'])) * 1000,
            'filterEffective'  => ! empty($status['effective']),
            'strings'          => array(
                'empty'          => __('请输入 Pixiv 作品 ID 或链接', 'zibll-pixiv'),
                'invalid'        => __('无法识别输入，请粘贴 Pixiv 作品链接或纯数字 ID', 'zibll-pixiv'),
                'leadingZero'    => __('作品 ID 不能以 0 开头', 'zibll-pixiv'),
                'invalidPage'    => __('页码格式不正确', 'zibll-pixiv'),
                'loadingGallery' => __('已加载 {count} 张，正在加载第 {page} 张…', 'zibll-pixiv'),
                'paused'         => __('已加载 {count} 张，暂时无法确认第 {page} 张是否存在，可重试。', 'zibll-pixiv'),
                'limit'          => __('已加载 {count} 张，已达到第 {limit} 页安全上限，未继续探测。', 'zibll-pixiv'),
                'imagePage'      => __('第 {page} 张', 'zibll-pixiv'),
                'network'        => __('网络超时，请检查网络后重试', 'zibll-pixiv'),
                'badRequest'     => __('作品 ID 格式不正确，请检查后重试', 'zibll-pixiv'),
                'notFound'       => __('作品不存在、已被删除或限制访问', 'zibll-pixiv'),
                'server'         => __('图片代理服务异常，请稍后重试', 'zibll-pixiv'),
                'busy'            => __('服务繁忙，请稍后自动重试', 'zibll-pixiv'),
                'notImage'        => __('未获取到图片', 'zibll-pixiv'),
                'failed'          => __('暂时无法获取，请稍后再试或切换代理域名', 'zibll-pixiv'),
                'download'        => __('下载原图', 'zibll-pixiv'),
                'copy'            => __('复制直链', 'zibll-pixiv'),
                'copied'          => __('已复制', 'zibll-pixiv'),
                'retry'           => __('重试', 'zibll-pixiv'),
                'downloadFallback' => __('浏览器无法直接下载，将在新窗口打开图片。', 'zibll-pixiv'),
            ),
        );
        wp_localize_script('zibll-pixiv-viewer', 'ZibllPixivConfig', $context);
    }

    public function body_class(array $classes): array
    {
        if (Zibll_Pixiv_Rewrite::is_viewer_request()) {
            $classes[] = 'zibll-pixiv-page';
        }

        return $classes;
    }

    public function admin_notices(): void
    {
        if (! current_user_can('manage_options')) {
            return;
        }

        if (version_compare(PHP_VERSION, '8.0', '<') || version_compare(get_bloginfo('version'), '7.0', '<')) {
            echo '<div class="notice notice-error"><p>' . esc_html__('Zibll Pixiv 需要 PHP 8.0+ 与 WordPress 7.0+。请升级环境后再启用查看器。', 'zibll-pixiv') . '</p></div>';
        }

        $theme = wp_get_theme();
        if (! $theme->exists()) {
            echo '<div class="notice notice-warning"><p>' . esc_html__('Zibll Pixiv 未检测到有效主题，将使用独立模板渲染；请先启用主题以获得完整的站点页眉、页脚和灯箱体验。', 'zibll-pixiv') . '</p></div>';
        }
    }

    /**
     * @param string[] $links Plugin action links.
     * @return string[]
     */
    public function action_links(array $links): array
    {
        array_unshift(
            $links,
            '<a href="' . esc_url(admin_url('options-general.php?page=zibll-pixiv')) . '">' . esc_html__('设置', 'zibll-pixiv') . '</a>'
        );
        return $links;
    }

    private function should_enqueue_assets(): bool
    {
        if (Zibll_Pixiv_Rewrite::is_viewer_request()) {
            return true;
        }

        if (is_singular()) {
            global $post;
            return $post instanceof WP_Post && has_shortcode((string) $post->post_content, 'zibll_pixiv_viewer');
        }

        return false;
    }
}
