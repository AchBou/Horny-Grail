<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';

    // The gallery is the home page.
    onMount(() => {
        goto(`/browse${window.location.search}`, { replaceState: true });
    });
</script>
