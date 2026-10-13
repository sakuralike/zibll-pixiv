<?php
/**
 * Viewer template. Themes may copy this file to zibll-pixiv/viewer.php.
 *
 * @package Zibll_Pixiv
 */

if (! defined('ABSPATH')) {
    exit;
}

/*
 * template_include receives a file path and therefore has no local context.
 * Bootstrap once, then render the same file with the prepared context.
 */
if (! isset($context) || ! is_array($context)) {
    if (empty($GLOBALS['zibll_pixiv_template_bootstrapped'])) {
        $GLOBALS['zibll_pixiv_template_bootstrapped'] = true;
        Zibll_Pixiv_Rewrite::render(array('template' => __FILE__));
        unset($GLOBALS['zibll_pixiv_template_bootstrapped']);
    }
    return;
}

$options = $context['options'];
$id = (string) $context['id'];
$page = (int) $context['page'];
$blocked = ! empty($context['blocked']);
$embedded = ! empty($context['embedded']);
$error = (string) $context['error'];
$initial_message = $blocked ? (string) $context['blocked_message'] : $error;
$filter_status = Zibll_Pixiv_Settings::blocklist_status($options);
$viewer_url = $id !== '' ? Zibll_Pixiv_Rewrite::viewer_url($id, $page, (string) $context['user_id']) : $context['base_url'];

if (! $embedded && function_exists('get_header')) {
    get_header();
}
?>
<main
    class="zibll-pixiv-viewer container"
    data-zibll-pixiv-viewer
    data-id="<?php echo esc_attr($id); ?>"
    data-page="<?php echo esc_attr((string) $page); ?>"
    data-base-url="<?php echo esc_url($context['base_url']); ?>"
    data-viewer-url="<?php echo esc_url($viewer_url); ?>"
    data-blocked="<?php echo $blocked ? '1' : '0'; ?>"
    data-filter-effective="<?php echo ! empty($filter_status['effective']) ? '1' : '0'; ?>"
>
    <header class="zibll-pixiv-header">
        <h1><?php echo esc_html($options['page_title']); ?></h1>
        <p class="zibll-pixiv-subtitle"><?php echo esc_html__('输入 Pixiv 作品 ID 或作品链接，直接在浏览器中预览。', 'zibll-pixiv'); ?></p>
    </header>

    <form class="zibll-pixiv-form" data-zibll-pixiv-form novalidate>
        <label for="zibll-pixiv-input" class="screen-reader-text"><?php echo esc_html__('Pixiv 作品 ID 或链接', 'zibll-pixiv'); ?></label>
        <input
            id="zibll-pixiv-input"
            class="zibll-pixiv-input"
            type="text"
            name="zibll_pixiv_input"
            inputmode="url"
            autocomplete="off"
            placeholder="<?php echo esc_attr__('例如：82775556 或 Pixiv 作品链接', 'zibll-pixiv'); ?>"
            value="<?php echo esc_attr($id); ?>"
        />
        <button class="zibll-pixiv-submit" type="submit"><?php echo esc_html__('查看图片', 'zibll-pixiv'); ?></button>
    </form>
    <p class="zibll-pixiv-form-error" data-zibll-pixiv-form-error role="alert"<?php echo $initial_message === '' ? ' hidden' : ''; ?>>
        <?php echo esc_html($initial_message); ?>
    </p>

    <section class="zibll-pixiv-result" data-zibll-pixiv-result aria-live="polite">
        <?php if ($blocked) : ?>
            <div class="zibll-pixiv-notice zibll-pixiv-notice--blocked" data-zibll-pixiv-blocked>
                <strong><?php echo esc_html($context['blocked_message']); ?></strong>
            </div>
        <?php elseif ($id !== '') : ?>
            <div class="zibll-pixiv-loading" data-zibll-pixiv-loading>
                <?php echo esc_html__('正在加载图片…', 'zibll-pixiv'); ?>
            </div>
        <?php else : ?>
            <div class="zibll-pixiv-empty" data-zibll-pixiv-empty>
                <?php echo esc_html__('提交作品 ID 后将在此处显示图片。', 'zibll-pixiv'); ?>
            </div>
        <?php endif; ?>

        <div class="zibll-pixiv-image-wrap" data-zibll-pixiv-image-wrap hidden>
            <a class="imgbox-container" data-imgbox data-zibll-pixiv-lightbox href="" target="_blank" rel="noopener">
                <img class="zibll-pixiv-image" data-zibll-pixiv-image loading="lazy" alt="" />
            </a>
        </div>

        <div class="zibll-pixiv-toolbar" data-zibll-pixiv-toolbar hidden>
            <button type="button" class="zibll-pixiv-button" data-zibll-pixiv-prev><?php echo esc_html__('上一张', 'zibll-pixiv'); ?></button>
            <label class="zibll-pixiv-page-field">
                <span><?php echo esc_html__('页码', 'zibll-pixiv'); ?></span>
                <input type="number" min="1" max="50" value="<?php echo esc_attr((string) $page); ?>" data-zibll-pixiv-page />
            </label>
            <button type="button" class="zibll-pixiv-button" data-zibll-pixiv-next><?php echo esc_html__('下一张', 'zibll-pixiv'); ?></button>
            <button type="button" class="zibll-pixiv-button zibll-pixiv-button--accent" data-zibll-pixiv-download><?php echo esc_html__('下载原图', 'zibll-pixiv'); ?></button>
            <button type="button" class="zibll-pixiv-button" data-zibll-pixiv-copy><?php echo esc_html__('复制直链', 'zibll-pixiv'); ?></button>
        </div>
        <p class="zibll-pixiv-status" data-zibll-pixiv-status role="status"></p>
    </section>

    <?php if ($id !== '') : ?>
        <p class="zibll-pixiv-source">
            <a href="<?php echo esc_url('https://www.pixiv.net/artworks/' . rawurlencode($id)); ?>" target="_blank" rel="noopener noreferrer">
                <?php echo esc_html__('在 Pixiv 查看原作品', 'zibll-pixiv'); ?>
            </a>
        </p>
    <?php endif; ?>

    <aside class="zibll-pixiv-compliance">
        <h2><?php echo esc_html__('使用说明与版权提示', 'zibll-pixiv'); ?></h2>
        <div class="zibll-pixiv-disclaimer"><?php echo wp_kses_post(wpautop($options['disclaimer'])); ?></div>
        <p><?php echo esc_html__('图片由浏览器直接请求第三方代理服务；该服务可能看到您的 IP 地址。本站不接收、不缓存、不落盘图片内容。', 'zibll-pixiv'); ?></p>
        <?php if (trim((string) $options['contact']) !== '') : ?>
            <p><strong><?php echo esc_html__('版权方联系入口：', 'zibll-pixiv'); ?></strong><br /><?php echo nl2br(esc_html($options['contact'])); ?></p>
        <?php else : ?>
            <p class="zibll-pixiv-contact-empty"><?php echo esc_html__('版权方如需下架，请联系站点管理员。', 'zibll-pixiv'); ?></p>
        <?php endif; ?>
    </aside>
</main>
<?php
if (! $embedded && function_exists('get_footer')) {
    get_footer();
}
