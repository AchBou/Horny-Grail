<script>
    export let src;

    function handleError(event) {
        event.target.src = 'https://via.placeholder.com/300x200?text=Image+Not+Found';
    }
</script>

<div class="thumbnail">
    <div class="image-container">
        <img {src} alt="thumbnail" on:error={handleError}>
    </div>
</div>

<style>
    .thumbnail {
        background-color: white;
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1);
        transition: transform 0.3s, box-shadow 0.3s;
        height: 100%;
        display: flex;
        flex-direction: column;
    }

    .image-container {
        width: 100%;
        aspect-ratio: 1 / 1;
        display: grid;
        place-items: center;
        padding: 8px;
        overflow: hidden;
        position: relative;
    }

    img {
        max-width: 100%;
        max-height: 100%;
        width: 100%;
        height: 100%;
        object-fit: contain;
        object-position: center;
        image-orientation: from-image;
        border-radius: 6px;
        transition: transform 0.3s;
    }

    .thumbnail:hover img {
        transform: scale(1.03);
    }
</style>
